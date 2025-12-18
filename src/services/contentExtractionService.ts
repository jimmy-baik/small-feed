import { extract, ArticleData } from '@extractus/article-extractor';
import { Post, ExtractedContent } from '@models/posts';
import { PostRepository } from '@repositories/postRepository';
import { llmClient, getEmbedding } from '@adapters/secondary/llm';
import { fetchTranscript } from 'youtube-transcript-plus';
import { TranscriptResponse } from 'youtube-transcript-plus/dist/types';
import { Innertube } from 'youtubei.js';
import Parser from 'rss-parser';
import { stripHtml } from "string-strip-html";

export async function ingestContent(url:string, feedId: number, userId: number, postsRepository: PostRepository) : Promise<void> {
    
  // RSS feed인 경우 feed에 등록된 전체 아티클을 처리하는 함수에 처리를 위임한 후 바로 종료한다.
  if (isRSSUrl(url)) {
    await ingestRSSFeedArticles(url, feedId, userId, postsRepository);
    return;
  }

  // 먼저 유튜브 video id를 추출할 수 있는지 확인한다. video id를 추출할 수 있는 경우 정해진 형식대로 url을 정규화한다. (중복 검사하기 전 패턴을 하나로 일치시킨다)
  const videoId = parseYoutubeVideoId(url);
  if (videoId) {
    url = normalizeYoutubeVideoUrl(videoId);
  }

  // 중복 검사 - 이미 존재하는 post인지 확인한다.
  let post: Post|null = await postsRepository.getPostByOriginalUrl(url);

  // 새로운 post인 경우에는 먼저 추출해서 저장한다.
  if (!post) {
    let extractedContent: ExtractedContent;
    if (videoId) {
      extractedContent = await extractYoutubeTranscript(videoId);
    } else {
      extractedContent = await extractArticle(url);
    }

    // 요약과 임베딩을 병렬로 생성한다
    const [summary, embedding] = await Promise.all([
        summarizeArticleContent(extractedContent.textContent).catch((err) => {
            console.log(err);
            return null;
        }),
        createPostEmbedding(extractedContent.textContent).catch((err) => {
            console.log(err);
            return null;
        })
    ]);

    if (summary === null || embedding === null) {
        throw new Error('요약과 임베딩 생성에 실패했습니다.');
    }

    // 게시글 저장 후 feed와 post의 관계를 추가한다.
    post = await postsRepository.createPost(
      extractedContent.originalUrl,
      extractedContent.textContent,
      extractedContent.htmlContent,
      extractedContent.title,
      summary,
      embedding
    );
  }

  // feed와 post의 관계를 추가한다.
  await postsRepository.createFeedToPostRelationship(feedId, post.postId, userId).catch((err) => {
    console.log(err);
  });
}


/**
 * 사용자가 제출한 url이 유튜브 url인지 확인한다.
 * @param url 사용자가 제출한 url
 * @returns 유튜브 주소인지 여부
 */
function parseYoutubeVideoId(url: string): string|null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
    /youtube\.com\/shorts\/((?:\d|[a-z]|[A-Z])+)/
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1] || null; // pattern 매치가 있을 경우 배열 0번이 youtube.com/watch ... , 1번이 video id 이다.
    }
  }
  return null;
}

function normalizeYoutubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`; // video id로 정해진 형식의 오리지널 url을 생성한다.
}

function isRSSUrl(url: string): boolean {
  const rssPatterns = [
    /\.xml$/i,
    /\/feed\/?$/i,
    /\/rss\/?$/i,
    /\/atom\/?$/i,
    /feed\.xml$/i,
    /rss\.xml$/i,
    /atom\.xml$/i
  ];

  for (const pattern of rssPatterns) {
    if (pattern.test(url)) {
      return true;
    }
  }

  return false;
}

async function extractArticle(url: string): Promise<ExtractedContent> {
    const article = await extract(url);
    if (!article || article.content === undefined) {
        throw new Error('글을 추출할 수 없습니다.');
    }

    return {
        originalUrl: url,
        title: article.title || '',
        htmlContent: article.content || '',
        textContent: stripHtml(article.content || '').result,
    };
}

async function extractYoutubeTranscript(videoId: string): Promise<ExtractedContent> {
    const [transcripts, videoInfo] = await Promise.all([fetchTranscript(videoId), getYoutubeVideoInfo(videoId)]);
    const transcriptText = transcripts.map((item: TranscriptResponse) => item.text).join('\n');
    const transcriptHtml = transcripts.map((item: TranscriptResponse) => `<p>${item.offset} - ${item.offset+item.duration}: ${item.text}</p>`).join('\n');
    return {
      title: videoInfo.title || '',
      textContent: transcriptText,
      htmlContent: `${videoInfo.description}\n\n${transcriptHtml}`,
      originalUrl: normalizeYoutubeVideoUrl(videoId) // video id로 정해진 형식의 오리지널 url을 생성한다.
  };
}

/**
 * await 가능한 비동기 sleep 편의 함수
 * @param milliseconds 대기할 시간 (밀리초)
 * @returns Promise<void>
 */
async function asyncSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function summarizeArticleContent(content: string, maxRetries:number = 7): Promise<string> {
  let retryCount = 0;
  let retryDelay = 10 * 1000; // 최초 실패시 10초 후 재시도. 연속 실패시 2배씩 증가하며 maxRetries 만큼 재시도한다.

  while (retryCount < maxRetries) {
    try {
      const response = await llmClient.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `이 글에서 독자가 기억해야 할 제일 중요한 요점을 짧은 3문장으로 요약해줘: ${content}`,
      });

      if (!response.text || response.text === undefined) {
        throw new Error('요약에 실패했습니다.');
      }

      return response.text;

    } catch (error) {
      retryCount += 1;
      
      if (retryCount >= maxRetries) {
        throw error;
      }

      console.log(`요약 생성 실패 (${retryCount}/${maxRetries}) 다음 시도까지 ${retryDelay}ms 대기... - ${error}`);
      await asyncSleep(retryDelay);
      retryDelay *= 2;
    }
  }

  throw new Error('요약에 실패했습니다.');
}


export async function createPostEmbedding(content: string): Promise<number[]> {
  return await getEmbedding(content);
}

async function getYoutubeVideoInfo(videoId: string): Promise<{title: string, description: string}> {

  const video = await Innertube.create({lang:'ko'});
  const videoInfo = await video.getBasicInfo(videoId);
  return {
    title: videoInfo.basic_info.title || '',
    description: videoInfo.basic_info.short_description || ''
  };
}

/**
 * RSS feed에서 모든 아티클을 가져와서 Post로 변환하여 저장한다.
 * @param rssFeedUrl RSS feed URL
 * @param createdByUsername 생성자 사용자명
 * @param postsRepository Post 저장소
 */

async function ingestRSSFeedArticles(
  rssFeedUrl: string,
  feedId: number,
  ownerUserId: number,
  postsRepository: PostRepository
): Promise<void> {

  const parser = new Parser();
  const feed = await parser.parseURL(rssFeedUrl);

  if (!feed.items || feed.items.length === 0) {
    console.log('RSS feed에서 아티클을 찾을 수 없습니다.');
    return;
  }

  const urlObject = new URL(rssFeedUrl);
  const rootUrl = urlObject.origin;
  console.log(`RSS feed 루트 URL: ${rootUrl}`);

  console.log(`RSS feed에서 ${feed.items.length}개의 아티클 발견. 처리를 시작합니다..`);
  for (const item of feed.items) {
    if (!item.link) {
      console.log(`RSS feed 아티클 링크 없음으로 건너뜀: ${item.title}`);
      continue;
    }

    try {
      let extractedContent: ExtractedContent;
      let fullyQualifiedSourceUrl: string;

      // 링크가 상대 경로인 경우 절대경로를 붙여서 저장
      if (item.link.startsWith(rootUrl)) {
        fullyQualifiedSourceUrl = item.link;
      } else {
        fullyQualifiedSourceUrl = rootUrl + item.link;
      }

      const existingPost = await postsRepository.getPostByOriginalUrl(fullyQualifiedSourceUrl);
      if (existingPost) {
        console.log(`RSS feed 아티클이 이미 존재하므로 컨텐츠 로딩을 건너뜁니다: ${item.title}`);

        const existingPostInFeed = await postsRepository.getPostInFeed(feedId, existingPost.postId);
        if (existingPostInFeed === null) {
          // 원본 컨텐츠가 이미 저장되어 있지만 현재 feed에는 없었을 경우 현재 feed와 post의 관계만 새로 추가한다.
          await postsRepository.createFeedToPostRelationship(feedId, existingPost.postId, ownerUserId);
        }

        continue;
      }

      // feed에서 가져온 메타데이터로 바로 Post 객체를 생성할 수 있다면 바로 변환한다
      if (item.title && item.pubDate && item.content) {
        console.log(`RSS feed 아티클 메타데이터로 바로 변환: ${item.title}`);
        extractedContent = {
            originalUrl: fullyQualifiedSourceUrl,
            title: item.title,
            htmlContent: item.content || '',
            textContent: stripHtml(item.content || '').result,
        }
      } else {
        // 아닌 경우에는 링크에 직접 방문해 아티클을 추출한다.
        console.log(`RSS feed 아티클 링크에 직접 방문해 아티클 추출: ${item.link}`);
        extractedContent = await extractArticle(fullyQualifiedSourceUrl);
      }

      // 요약과 임베딩을 병렬로 생성한다
      console.log(`RSS feed 아티클 요약과 임베딩 생성 시작: ${item.title}`);
      const [summary, embedding] = await Promise.all([
        summarizeArticleContent(extractedContent.textContent).catch((err) => {
          console.log(`요약 생성 실패 (${item.title}):`, err);
          return null;
        }),
        createPostEmbedding(extractedContent.textContent).catch((err) => {
          console.log(`임베딩 생성 실패 (${item.title}):`, err);
          return null;
        })
      ]);

      if (summary === null || embedding === null) {
        console.log(`요약 또는 임베딩 생성 실패로 건너뜀: ${item.title}`);
        continue;
      }

      // 요약과 임베딩을 포함하여 원본 컨텐츠를 저장한다
      const createdPost = await postsRepository.createPost(
        extractedContent.originalUrl,
        extractedContent.textContent,
        extractedContent.htmlContent,
        extractedContent.title,
        summary,
        embedding
      );

      // feed와 post의 관계를 추가한다.
      await postsRepository.createFeedToPostRelationship(feedId, createdPost.postId, ownerUserId);
      console.log(`RSS feed 아티클 성공적으로 저장됨: ${extractedContent.title}`);
    } catch (error) {
      // 개별 아티클 실패 시에는 다음 아티클로 계속 진행
      console.error(`RSS feed 아티클 처리 실패 (${item.title || item.link}):`, error);
      continue;
    }
  }
}
