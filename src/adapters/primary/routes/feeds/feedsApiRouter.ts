import express from 'express';
import db from '@adapters/secondary/db/client';
import { PostRepository } from '@repositories/postRepository';
import { FeedRepository } from '@repositories/feedRepository';
import { UserRepository } from '@repositories/userRepository';
import { getSearchEngine } from '@adapters/secondary/searchengine/searchEngineFactory';
import { requireLogin } from '@adapters/primary/middlewares/requireLogin';
import { requireFeedMembership } from '@adapters/primary/middlewares/requireFeedMembership';
import { User } from '@models/users';
import { ingestContent } from '@services/contentExtractionService';
import { getRecommendationsForUser } from '@services/searchService';
import { generateRandomString } from '@system/generators';

const router = express.Router();

// 게시글 Repository 설정
const searchEngine = getSearchEngine(process.env.SEARCH_ENGINE_TYPE || "meilisearch");
const postsRepository = new PostRepository(db, searchEngine);
const usersRepository = new UserRepository(db);
const feedsRepository = new FeedRepository(db);


// 피드 생성
router.post('/',
    requireLogin,
    async (req, res, next) => {
    try {
        if (!req.body || !req.body.title) {
            return res.status(400).json({
                error: '잘못된 요청입니다.',
                message: '제목을 입력해주세요.'
            });
        }

        const userId = (req.user as User).userId;
        const title = String(req.body.title);
        const slug = generateRandomString(10); // 10자리의 랜덤 문자열을 생성해서 url slug로 사용한다
        const feed = await feedsRepository.createFeed(title, slug, userId);

        return res.status(201).json({
            feedSlug: feed.slug
        });
    }
    catch (err) {
        next(err);
    }
});


// 무한 스크롤시 피드의 추천 게시글을 계속 조회하는 경로
router.get('/:feedSlug/recommendations',
    requireLogin,
    requireFeedMembership,
    async (req, res, next) => {
    try {

        const limit = parseInt(req.query.limit as string) || 10;
        const excludeIds = req.query.exclude ? (req.query.exclude as string).split(',').map(id => parseInt(id)) : [];

        const user = req.user as User;
        const feedSlug = String(req.params.feedSlug);
        const feed = await feedsRepository.getFeedBySlug(feedSlug);
        if (!feed) {
            return res.status(404).json({
                error: '피드를 찾을 수 없습니다.',
                message: '피드를 찾을 수 없습니다.'
            });
        }

        const {posts, userInteractionHistory} = await getRecommendationsForUser(user, feed, usersRepository, postsRepository, limit, excludeIds);

        res.json({
            posts: posts,
            hasMore: posts.length === limit
        });
    }
    catch (err) {
        next(err);
    }
});


// 피드에 게시글 추가
router.post('/:feedSlug/url',
    requireLogin,
    requireFeedMembership,
    async (req, res, next) => {
    try {
        const feedSlug = String(req.params.feedSlug);
        const feed = await feedsRepository.getFeedBySlug(feedSlug);
        if (!feed) {
            return res.status(404).json({
                error: '피드를 찾을 수 없습니다.',
                message: '피드를 찾을 수 없습니다.'
            });
        }

        const userId = (req.user as User).userId;
        if (!feed.memberUserIds.includes(userId)) {
            return res.status(403).json({
                error: '권한이 없습니다.',
                message: '자신이 속해 있는 피드에만 컨텐츠를 추가할 수 있습니다.'
            });
        }

        // 요청 데이터 검증
        if (!req.body || !req.body.url) {
            return res.status(400).json({
                error: '잘못된 요청입니다.',
                message: 'URL을 입력해주세요.'
            });
        }
        const originalUrl = String(req.body.url);

        // ingest 작업 예약
        ingestContent(originalUrl, feed.feedId, userId, postsRepository).catch((err) => {
            console.log(err);
        });

        // 작업 예약 후 바로 종료
        return res.status(201).json({
            message: '컨텐츠 추가 성공.'
        });

    } catch (err) {
        // 에러를 다음 미들웨어로 전달
        next(err);
    }
});


// 새 초대 링크를 생성
router.post('/:feedSlug/invites',
    requireLogin,
    requireFeedMembership,
    async (req, res, next) => {
    try {

        const feedSlug = String(req.params.feedSlug);
        const feed = await feedsRepository.getFeedBySlug(feedSlug);
        
        if (!feed) {
            return res.status(404).json({
                error: '피드를 찾을 수 없습니다.',
                message: '피드를 찾을 수 없습니다.'
            });
        }

        const userId = (req.user as User).userId;
        
        // 피드에 속한 사람이 아니라면 생성 불가
        if (feed.ownerUserId !== userId && !feed.memberUserIds.includes(userId)) {
            return res.status(403).json({
                error: '권한이 없습니다.',
                message: '피드 멤버만 초대 링크를 생성할 수 있습니다.'
            });
        }

        // 기본 유효기간은 7일로 생성한다
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // 랜덤한 토큰 문자열을 생성한다
        const inviteToken = generateRandomString(12);

        const invite = await feedsRepository.createFeedInvite(
            feed.feedId,
            userId,
            inviteToken,
            expiresAt
        );

        // 초대 링크 URL을 조립한다
        const baseUrl = process.env.CURRENT_SERVER_ROOT_URL || 'http://localhost:3002';
        const inviteUrl = `${baseUrl}/feeds/invite/${invite.inviteToken}`;

        return res.status(200).json({inviteUrl: inviteUrl});
    } catch (err) {
        next(err);
    }
});

export default router;