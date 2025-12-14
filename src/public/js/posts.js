class InfiniteScrollFeedController {
    constructor(feedSlug) {
        this.currentPage = 1;
        this.isLoading = false;
        this.hasMore = true;
        this.loadedPostIds = new Set();
        this.postsContainer = document.querySelector('.posts-list');
        this.loadingIndicator = this.createLoadingIndicator();
        this.feedSlug = feedSlug;
        
        this.init();
    }

    init() {
        const existingPosts = document.querySelectorAll('.post-item');
        existingPosts.forEach(post => {
            const postId = post.querySelector('a[data-post-id]').getAttribute('data-post-id');
            this.loadedPostIds.add(postId);
        });
    }

    createLoadingIndicator() {
        // 로딩 템플릿을 가져온다.
        const template = document.getElementById('loading-template');
        if (!template) {
            console.error('로딩 템플릿을 찾을 수 없습니다.');
            // fallback
            const indicator = document.createElement('div');
            indicator.className = 'loading-indicator';
            indicator.innerHTML = '<div class="spinner"></div><p>더 많은 추천 게시글을 불러오는 중...</p>';
            indicator.style.display = 'none';
            return indicator;
        }

        // 템플릿을 복제한다.
        const indicator = template.content.cloneNode(true);
        indicator.querySelector('.loading-indicator').style.display = 'none';
        return indicator.querySelector('.loading-indicator');
    }

    createPostElement(post) {
        // 게시글 row 템플릿을 가져온다.
        const template = document.getElementById('post-template');
        if (!template) {
            console.error('Post template not found');
            return document.createElement('div');
        }

        // 템플릿을 복제한다.
        const article = template.content.cloneNode(true);
        
        // 날짜 포맷팅
        const formattedDate = new Date(post.submittedAt).toLocaleDateString('ko-KR', {
            month: 'short',
            day: 'numeric'
        });

        // 본문 미리보기 포맷팅
        const contentPreview = post.textContent 
            ? (post.textContent.length > 150 ? post.textContent.substring(0, 150) + '...' : post.textContent)
            : '설명 없음';

        // 게시글 데이터를 템플릿에 업데이트한다.
        // const authorName = article.querySelector('.post-author-info .author-name');
        const titleLink = article.querySelector('.post-title a');
        const subtitleDiv = article.querySelector('.post-subtitle');
        const dateSpan = article.querySelector('.post-meta .meta-item span');
        const heartIcon = article.querySelector('.heart-icon');

        // // 글쓴이 설정
        // if (authorName) {
        //     authorName.textContent = post.createdBy;
        // }

        // 제목 링크 설정
        if (titleLink) {
            titleLink.href = post.originalUrl || `/posts/${post.postId}`;
            titleLink.textContent = post.title;
            titleLink.setAttribute('data-post-id', post.postId);
        }

        // 본문 미리보기 설정
        if (subtitleDiv) {
            subtitleDiv.textContent = contentPreview;
        }

        // 날짜 설정
        if (dateSpan) {
            dateSpan.textContent = formattedDate;
        }

        // 좋아요 버튼 data-post-id 설정
        if (heartIcon) {
            heartIcon.setAttribute('data-post-id', post.postId);
        }

        // 아코디언 설정 (summary가 있는 경우)
        if (post.generatedSummary) {
            const accordionSection = article.querySelector('.accordion-section');
            const accordionSummary = article.querySelector('.accordion-summary');
            const viewFullBtn = article.querySelector('.view-full-btn');
            
            if (accordionSection) {
                accordionSection.setAttribute('data-post-id', post.postId);
            }
            
            if (accordionSummary) {
                accordionSummary.textContent = post.generatedSummary;
            }
            
            if (viewFullBtn && post.originalUrl) {
                viewFullBtn.href = post.originalUrl;
            }
        } else {
            // summary가 없으면 아코디언 섹션 제거
            const accordionSection = article.querySelector('.accordion-section');
            if (accordionSection) {
                accordionSection.remove();
            }
        }

        return article;
    }

    async loadMorePosts() {
        
        if (this.isLoading || !this.hasMore) return;

        this.isLoading = true;
        this.showLoadingIndicator();

        try {
            if (!this.feedSlug) {
                console.error('feed 정보가 없습니다. 추천 게시글을 불러올 수 없습니다.');
                this.hasMore = false;
                return;
            }

            const excludeIds = Array.from(this.loadedPostIds);
            const response = await fetch(
                `/api/feeds/${this.feedSlug}/recommendations?limit=5&exclude=${excludeIds.join(',')}`
            );

            if (!response.ok) {
                throw new Error('Failed to load recommendations');
            }

            const data = await response.json();
            
            if (data.posts && data.posts.length > 0) {
                this.renderPosts(data.posts);
                this.currentPage++;
                this.hasMore = data.hasMore;
            } else {
                this.hasMore = false;
            }

        } catch (error) {
            console.error('추천 게시글을 불러오는데 실패했습니다. 오류:', error);
            this.showError('추천 게시글을 불러오는데 실패했습니다.');
        } finally {
            this.isLoading = false;
            this.hideLoadingIndicator();
        }
    }

    renderPosts(posts) {
        posts.forEach(post => {
            if (!this.loadedPostIds.has(post.postId)) {
                const postElement = this.createPostElement(post);
                this.postsContainer.appendChild(postElement);
                this.loadedPostIds.add(post.postId);
            }
        });
        // scrollTarget을 리스트의 마지막으로 이동
        this.moveScrollTargetToEnd();
    }

    moveScrollTargetToEnd() {
        const scrollTarget = document.querySelector('#scroll-target');
        if (scrollTarget && this.postsContainer) {

            // 맨 끝으로 이동 (appendChild는 자동으로 이동)
            this.postsContainer.appendChild(scrollTarget);
        }
    }

    showLoadingIndicator() {
        this.loadingIndicator.style.display = 'block';
        const scrollTarget = document.querySelector('#scroll-target');
        if (scrollTarget && scrollTarget.parentNode === this.postsContainer) {
            // scrollTarget 앞에 로딩 인디케이터 삽입
            this.postsContainer.insertBefore(this.loadingIndicator, scrollTarget);
        } else {
            // scrollTarget이 없으면 맨 끝에 추가
            this.postsContainer.appendChild(this.loadingIndicator);
        }
    }

    hideLoadingIndicator() {
        this.loadingIndicator.style.display = 'none';
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            text-align: center;
            padding: 20px;
            color: #dc3545;
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
            margin: 20px 0;
        `;
        this.postsContainer.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }
}

export class ModalController {
    constructor(triggerElementId=null, modalElementId=null, closeButtonElementId=null) {
        this.findElements(triggerElementId, modalElementId, closeButtonElementId);
    }

    findElements(triggerElementId, modalElementId, closeButtonElementId) {
        if (!triggerElementId || !modalElementId || !closeButtonElementId) {
            throw new Error('triggerElementId, modalElementId, closeButtonElementId가 모두 지정되지 않았습니다.');
        }
        this.triggerElement = document.getElementById(triggerElementId);
        this.modalElement = document.getElementById(modalElementId);
        this.closeButtonElement = document.getElementById(closeButtonElementId);
        this.documentBody = document.body;

        if (!this.triggerElement || !this.modalElement || !this.closeButtonElement || !this.documentBody) {
            throw new Error('triggerElement, modalElement, closeButtonElement를 찾을 수 없습니다.');
        }
    }

    openModal() {
        this.modalElement?.classList.add('is-open');
        this.documentBody.classList.add('modal-open');
        this.closeButtonElement?.focus();

    }

    closeModal() {
        this.modalElement?.classList.remove('is-open');
        this.documentBody.classList.remove('modal-open');
        this.triggerElement?.focus();
    }

    initEventListeners() {
        const openModal = (e) => {
            e.preventDefault();
            this.openModal();
        };

        const closeModal = (e) => {
            e.preventDefault();
            this.closeModal();
        };

        this.triggerElement.addEventListener('click', openModal);
        this.closeButtonElement.addEventListener('click', closeModal);
        this.modalElement.addEventListener('click', (event) => {
            if (event.target === this.modalElement) {
                closeModal();
            }
        });
    }

}

// html inline 스크립트에서 바로 로드
window.ModalController = ModalController;

function toggleLike(postId, heartIcon) {
    fetch(`/api/posts/${postId}/like`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            if (response.ok) {
                heartIcon.classList.toggle('liked');
                // fill 속성도 업데이트
                if (heartIcon.classList.contains('liked')) {
                    heartIcon.setAttribute('fill', 'currentColor');
                } else {
                    heartIcon.setAttribute('fill', 'none');
                }
            } else {
                throw new Error('좋아요 처리에 실패했습니다.');
            }
        })
        .catch(error => {
            console.error('Error:', error);
        });
}


function toggleAccordion(clickedAccordion) {    
    // 클릭된 아코디언을 토글한다
    clickedAccordion.classList.toggle('expanded');
}

function showToast(message, duration = 3000, type = '') {

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

function copyToClipboard() {

    const inviteUrl = document.getElementById('inviteUrl').value;

    const copyBtn = document.getElementById('copyBtn');
    
    navigator.clipboard.writeText(inviteUrl).then(function() {
        // 복사 성공 시 버튼 텍스트 변경
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '복사됨!';
        copyBtn.classList.remove('not-copied');
        copyBtn.classList.add('copied');
        
        // 2초 후 원래 텍스트로 복원
        setTimeout(function() {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('copied');
            copyBtn.classList.add('not-copied');
        }, 2000);
    })
}

function logUserVisitedPost(postId) {
    
    fetch(`/api/posts/${postId}/viewed`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('게시글 열람이력 추적에 실패했습니다.');
        }
    })
    .catch(error => {
        console.error('게시글 열람이력 기록 중 오류가 발생했습니다:', error);
    });
}

function setUpInfiniteScroll() {

    const postsList = document.querySelector('.posts-list');
    const scrollTarget = document.querySelector('#scroll-target');

    if (!postsList || !scrollTarget) {
        // posts-list 또는 scroll-target 엘리먼트가 없으면 무한 스크롤을 사용하지 않는다.
        throw new Error('posts-list 또는 scroll-target 엘리먼트가 없습니다.');
    }

    const urlParams = new URLSearchParams(window.location.search);
    const userQuery = urlParams.get('q');
    if (userQuery) {
        // 검색어가 입력되어 있으면 무한스크롤을 시작하지 않는다 (검색결과만 보는 경우임)
        throw new Error('검색어가 입력되어 있으면 무한스크롤을 시작하지 않습니다.');
    }

    // feedSlug를 content-container에서 가져온다.
    const contentContainer = document.querySelector('.content-container');
    const feedSlug = contentContainer ? contentContainer.getAttribute('data-feed-slug') : null;
    
    // 무한 스크롤 컨트롤러를 intersection observer에 연결한다.
    const feedController = new InfiniteScrollFeedController(feedSlug);
    
    const scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            // isIntersecting이 true이고 intersectionRatio가 0보다 크면 트리거
            if (entry.isIntersecting && entry.intersectionRatio > 0) {
                feedController.loadMorePosts();
            }
        });
    },{
        rootMargin: '0px 0px 50px' // 상, 좌우, 하
    });
    scrollObserver.observe(scrollTarget);

    // 좋아요 버튼 클릭시 이벤트 리스너. 목록이 동적으로 바뀌므로 상위 요소에 리스너를 추가해서 위임한다.
    postsList.addEventListener('click', function(e) {
        // 클릭된 요소가 heart-icon이거나 그 자식인지 확인
        const heartIcon = e.target.closest('.heart-icon');
        if (heartIcon) {
            e.preventDefault();
            const postId = heartIcon.getAttribute('data-post-id');
            if (postId) {
                toggleLike(postId, heartIcon);
            }
        }
    });

    // 게시글 열람이력 추적
    postsList.addEventListener('click', function(e) {
        // 클릭된 요소가 data-post-id를 가진 링크인지 확인
        const postLink = e.target.closest('a[data-post-id]');
        if (postLink) {
            const postId = postLink.getAttribute('data-post-id');
            if (postId) {
                logUserVisitedPost(postId);
            }
        }
    });

    // 아코디언 토글 이벤트 리스너
    postsList.addEventListener('click', function(e) {
        // 클릭된 요소가 accordion-toggle 버튼이거나 그 자식인지 확인
        const accordionToggle = e.target.closest('.accordion-toggle');
        if (accordionToggle) {
            e.preventDefault();
            const accordionSection = accordionToggle.closest('.accordion-section');
            if (accordionSection) {
                toggleAccordion(accordionSection);
            }
        }
    });
}

function setUpFeedsOverviewList() {

    const feedsList = document.querySelector('.feeds-list');
    if (!feedsList) {
        throw new Error('feeds-list 엘리먼트가 없습니다.');
    }

    feedsList.addEventListener('click', function(e) {
        const postLink = e.target.closest('a[data-post-id]');
        if (postLink) {
            const postId = postLink.getAttribute('data-post-id');
            if (postId) {
                logUserVisitedPost(postId);
            }
        }
    });

}

function setUpNewFeedModal() {
    const modalController = new ModalController('new-feed-trigger', 'new-feed-modal', 'new-feed-modal-close');
    modalController.initEventListeners();

    const emptyTrigger = document.getElementById('new-feed-trigger-empty');
    if (emptyTrigger) {
        emptyTrigger.addEventListener('click', function(e) {
            e.preventDefault();
            document.getElementById('new-feed-modal').classList.add('is-open');
            document.body.classList.add('modal-open');
            document.getElementById('new-feed-modal-close').focus();
        });
    }

    const feedForm = document.getElementById('feedForm');
    if (feedForm) {
        feedForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const title = document.getElementById('title').value;
            const data = {
                title: title
            };
            
            try {
                const response = await fetch('/api/feeds', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    window.location.reload();
                } else {
                    const error = await response.json();
                    alert(error.message || '피드 생성에 실패했습니다.');
                }
            } catch (error) {
                alert('피드 생성 중 오류가 발생했습니다.');
            }
        });
    }
}

function setUpNewInviteContentModal() {
    const contentContainer = document.querySelector('.content-container');
    const feedSlug = contentContainer ? contentContainer.getAttribute('data-feed-slug') : null;
    if (!feedSlug) {
        throw new Error('feedSlug가 없습니다.');
    }

    // 새 URL 추가 모달 설정
    const newUrlModal = document.getElementById('new-url-modal');
    const newUrlModalClose = document.getElementById('new-url-modal-close');
    const newUrlTriggers = [
        document.getElementById('new-url-trigger'),
        document.getElementById('new-url-trigger-navbar')
    ].filter(Boolean);
    
    let newUrlModalController = null;
    if (newUrlModal && newUrlModalClose && newUrlTriggers.length > 0) {
        // 첫 번째 트리거로 ModalController 초기화
        newUrlModalController = new ModalController(
            newUrlTriggers[0].id, 
            'new-url-modal', 
            'new-url-modal-close'
        );
        newUrlModalController.initEventListeners();
        
        // 나머지 트리거 버튼들도 모달 열기 기능 추가
        newUrlTriggers.slice(1).forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                newUrlModalController.openModal();
            });
        });
    }

    // 새 URL 폼 제출 처리
    const newUrlForm = document.getElementById('newUrlForm');
    if (newUrlForm) {
        newUrlForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const url = document.getElementById('url').value;
            
            try {
                const response = await fetch(`/api/feeds/${feedSlug}/url`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url: url })
                });
                
                if (response.ok || response.redirected) {
                    newUrlModalController.closeModal();
                    showToast('컨텐츠 추가 성공!\n잠시 후 피드에 나타나요.', 3000, 'success');
                } else {
                    // JSON 에러 응답 시도
                    try {
                        const error = await response.json();
                        alert(error.message || '컨텐츠 추가에 실패했습니다.');
                    } catch {
                        alert('컨텐츠 추가에 실패했습니다.');
                    }
                }
            } catch (error) {
                console.error('Error:', error);
                alert('컨텐츠 추가 중 오류가 발생했습니다.');
            }
        });
    }

    // 새 초대 링크 모달 설정
    const newInviteModalController = new ModalController('new-invite-trigger', 'new-invite-modal', 'new-invite-modal-close');
    newInviteModalController.initEventListeners();

    // 닫기 버튼 이벤트
    const newInviteCloseBtn = document.getElementById('new-invite-close-btn');
    if (newInviteCloseBtn) {
        newInviteCloseBtn.addEventListener('click', function() {
            newInviteModalController.closeModal();
        });
    }

    // 초대 링크 생성 모달 열기
    const newInviteTrigger = document.getElementById('new-invite-trigger');
    if (newInviteTrigger) {
        newInviteTrigger.addEventListener('click', async function(e) {
            e.preventDefault();
            
            try {
                const response = await fetch(`/api/feeds/${feedSlug}/invites`, {
                    method: 'POST'
                });
                if (!response.ok) {
                    throw new Error('초대 링크 생성에 실패했습니다.');
                }

                const responseJson = await response.json();
                const inviteUrl = responseJson.inviteUrl;


                const modalInviteUrlInput = document.getElementById('inviteUrl');
                if (modalInviteUrlInput) {
                    modalInviteUrlInput.value = inviteUrl;
                    newInviteModalController.openModal();
                }

            } catch (error) {
                alert('초대 링크 생성에 실패했습니다.');
            }
        });
    }

    // 복사 버튼 클릭 이벤트
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', function() {
            const inviteUrl = document.getElementById('inviteUrl').value;
            
            navigator.clipboard.writeText(inviteUrl).then(function() {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '복사됨!';
                copyBtn.classList.remove('not-copied');
                copyBtn.classList.add('copied');
                
                setTimeout(function() {
                    copyBtn.textContent = originalText;
                    copyBtn.classList.remove('copied');
                    copyBtn.classList.add('not-copied');
                }, 2000);
            }).catch(function(err) {
                console.error('복사 실패:', err);
                alert('링크 복사에 실패했습니다.');
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {

    try {
        setUpFeedsOverviewList();
    } catch (error) {
        console.log('피드 개요 리스트 init 건너뜀')
    }

    try {
        setUpInfiniteScroll();
    } catch (error) {
        console.log('무한스크롤 init 건너뜀')
    }

    // 복사 버튼 클릭시 이벤트 리스너
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', function() {
            copyToClipboard();
        });
    }

    const currentUrl = window.location.pathname;
    if (currentUrl.endsWith('/feeds')) {
        setUpNewFeedModal();
    } else if (currentUrl.includes('/feeds/')) {
        setUpNewInviteContentModal();
    }

});