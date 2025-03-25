/**
 * Optimized Facebook post scraper with improved scrolling and content detection
 */
class FacebookScraper {
  constructor() {
    this.scrapedPosts = [];
    this.processedIds = new Set(); // More efficient than array for lookups
    this.isCollecting = false;
    this.isPaused = false;
    this.isLoading = false;
    this.groupInfo = null;
    this.postsToCollect = 0;
    this.lastLoadTime = 1000; // Dynamic loading time tracker
    this.observer = null; // For intersection observer
    this.sentinelElement = null;
    this.debugMode = true; // Enable for console logs
  }

  /**
   * Debug logging
   */
  log(message, data = null) {
    if (this.debugMode) {
      if (data) {
        console.log(`[FB Scraper] ${message}`, data);
      } else {
        console.log(`[FB Scraper] ${message}`);
      }
    }
  }

  /**
   * Extract group info from the current page
   */
  extractGroupInfo() {
    try {
      // Multiple selector strategies for group name
      const nameSelectors = [
        '[role="main"] h1',
        '[role="main"] [role="heading"]',
        'div[data-pagelet="GroupInlineHeader"] h1'
      ];

      let nameElement = null;
      for (const selector of nameSelectors) {
        nameElement = document.querySelector(selector);
        if (nameElement) break;
      }

      const groupName = nameElement
        ? nameElement.textContent.trim()
        : 'Unknown Group';

      // Get group ID from URL
      const urlMatch = window.location.href.match(
        /facebook\.com\/groups\/([^/]+)/
      );
      const groupId = urlMatch ? urlMatch[1] : 'unknown';

      // Try multiple selectors for member count
      const memberCountSelectors = [
        'a[href*="members"] span',
        'div[data-pagelet="GroupInlineHeader"] span:contains("member")',
        'div[data-pagelet="GroupInlineHeader"] div:contains("member")'
      ];

      let memberCountEl = null;
      for (const selector of memberCountSelectors) {
        try {
          memberCountEl = document.querySelector(selector);
          if (memberCountEl) break;
        } catch (e) {
          // Some complex selectors may fail
          continue;
        }
      }

      const membersCount = memberCountEl
        ? memberCountEl.textContent.trim()
        : 'Unknown';

      this.log('Extracted group info', {
        name: groupName,
        id: groupId,
        members: membersCount
      });

      this.groupInfo = {
        name: groupName,
        id: groupId,
        url: window.location.href,
        membersCount: membersCount,
        scrapedAt: new Date().toISOString()
      };

      return this.groupInfo;
    } catch (error) {
      console.error('Error extracting group info:', error);
      return null;
    }
  }

  /**
   * Setup Intersection Observer for smoother scrolling
   */
  setupIntersectionObserver() {
    // Remove existing observer and sentinel if any
    if (this.observer && this.sentinelElement) {
      this.observer.disconnect();
      if (this.sentinelElement.parentNode) {
        this.sentinelElement.parentNode.removeChild(this.sentinelElement);
      }
    }

    // Create a sentinel element to detect when we're near the bottom
    this.sentinelElement = document.createElement('div');
    this.sentinelElement.id = 'fb-scraper-sentinel';
    this.sentinelElement.style.height = '1px';
    this.sentinelElement.style.width = '100%';

    // Append to feed or bottom of page
    const feed = document.querySelector('[role="feed"]') || document.body;
    feed.appendChild(this.sentinelElement);

    this.log('Sentinel element added to page');

    // Create observer that triggers when sentinel becomes visible
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (
            entry.isIntersecting &&
            this.isCollecting &&
            !this.isPaused &&
            !this.isLoading
          ) {
            this.log('Sentinel visible, loading more content');
            this.loadMoreContent();
          }
        });
      },
      {
        rootMargin: '200px' // Start loading before we reach the bottom
      }
    );

    // Start observing the sentinel
    this.observer.observe(this.sentinelElement);
  }

  /**
   * Load more content with smooth scrolling
   */
  async loadMoreContent() {
    // Prevent multiple simultaneous loads
    if (this.isLoading || this.isPaused) return;

    this.isLoading = true;

    // Get current scroll position and page height
    const scrollHeight = document.documentElement.scrollHeight;
    const scrollPosition = window.scrollY + window.innerHeight;
    const distance = scrollHeight - scrollPosition;

    this.log(`Loading more content. Distance to bottom: ${distance}px`);

    // Only scroll if we're not at the bottom
    if (distance > 10) {
      // Smooth scroll in smaller increments
      const scrollSteps = 8;
      for (let i = 0; i < scrollSteps; i++) {
        if (this.isPaused) break;

        window.scrollBy({
          top: distance / scrollSteps,
          behavior: 'smooth'
        });

        // Small pause between scroll steps
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Dynamic timeout based on previous load times
    const timeout = Math.max(500, Math.min(2000, this.lastLoadTime));

    this.log(`Waiting ${timeout}ms for content to load`);
    const startTime = Date.now();

    // Wait for content to load
    await new Promise((resolve) => setTimeout(resolve, timeout));

    // Process new posts if not paused
    if (!this.isPaused) {
      // Use improved post detection
      const newPosts = this.getPosts();

      // Update performance metrics
      this.lastLoadTime = Date.now() - startTime;

      // Reposition sentinel at the bottom
      this.updateSentinelPosition();

      this.log(`Loaded ${newPosts.length} new posts in ${this.lastLoadTime}ms`);
    }

    this.isLoading = false;
  }

  /**
   * Update sentinel position to bottom of feed
   */
  updateSentinelPosition() {
    if (this.sentinelElement) {
      const feed = document.querySelector('[role="feed"]') || document.body;
      feed.appendChild(this.sentinelElement);
    }
  }

  /**
   * Extract post ID for duplicate detection
   */
  extractPostId(postElement) {
    try {
      // Debug log the element
      if (this.debugMode) {
        console.log('Attempting to extract ID from:', postElement);
      }

      // Try multiple ways to get post ID

      // Method 1: From data attributes
      let postId = postElement.getAttribute('data-ft');
      if (postId) {
        try {
          const dataFt = JSON.parse(postId);
          if (dataFt.top_level_post_id) {
            return dataFt.top_level_post_id;
          }
        } catch (e) {
          // Failed to parse JSON, continue to other methods
        }
      }

      // Method 2: From post_id in HTML - use a more forgiving regex
      const htmlContent = postElement.innerHTML;
      const postIdRegexes = [
        /"post_id":"(\d+)"/,
        /"post_id":(\d+)/,
        /\/posts\/(\d+)/,
        /\/permalink\/(\d+)/,
        /&id=(\d+)/
      ];

      for (const regex of postIdRegexes) {
        const match = htmlContent.match(regex);
        if (match && match[1]) {
          return match[1];
        }
      }

      // Method 3: Generate unique ID using timestamp and random string
      return `generated_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}`;
    } catch (e) {
      console.error('Error extracting post ID:', e);
      return `error_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}`;
    }
  }

  /**
   * Simple string hash function for content-based IDs
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Extract a single post with improved selectors
   */
  async extractPostData(postElement) {
    if (!postElement) return null;

    try {
      console.log('Đang xử lý bài viết:', {
        role: postElement.getAttribute('role'),
        class: postElement.className,
        height: postElement.offsetHeight
      });

      // Expand all "See more" buttons
      const buttons = postElement.querySelectorAll('[role="button"]');
      for (const button of buttons) {
        if (
          button.textContent.includes('See more') ||
          button.textContent.includes('Xem thêm')
        ) {
          try {
            button.click();
            await new Promise((resolve) => setTimeout(resolve, 300));
          } catch (e) {
            console.warn('Lỗi khi nhấn nút xem thêm:', e);
          }
        }
      }

      // Lấy ID của bài viết
      const postId =
        this.extractPostId(postElement) || `generated_${Date.now()}`;

      // THAY ĐỔI: Sử dụng cách tiếp cận khác để lấy nội dung
      let postText = '';

      // 1. Thử lấy văn bản từ article
      const contentContainers = [
        ...postElement.querySelectorAll('div[dir="auto"]'),
        ...postElement.querySelectorAll('[data-ad-comet-preview="message"]'),
        ...postElement.querySelectorAll('span.x193iq5w'),
        ...postElement.querySelectorAll('div.xdj266r')
      ];

      // 2. Lọc và kết hợp nội dung
      const paragraphs = new Set();

      for (const container of contentContainers) {
        const text = container.textContent.trim();

        // Bỏ qua nút, metadata và các phần tử ngắn
        if (
          text &&
          text.length > 15 &&
          !text.includes('See more') &&
          !text.includes('Xem thêm') &&
          !text.includes('Like') &&
          !text.includes('Comment') &&
          !text.includes('Share') &&
          !text.includes('Thích') &&
          !text.includes('Bình luận') &&
          !text.includes('Chia sẻ') &&
          !text.includes('ago') &&
          !text.includes('phút') &&
          !text.includes('giờ')
        ) {
          paragraphs.add(text);
          console.log(
            `Đã tìm thấy đoạn nội dung: "${text.substring(0, 50)}..."`
          );
        }
      }

      postText = Array.from(paragraphs).join('\n\n');

      if (!postText) {
        console.warn('Không tìm thấy nội dung văn bản!');
      }

      // Các thông tin khác giữ nguyên theo hàm hiện tại

      return {
        postId,
        content: postText || '[No content extracted]',
        author: this.extractAuthor(postElement) || 'Unknown',
        timestamp:
          this.extractTimestamp(postElement) || new Date().toISOString(),
        likes: this.extractLikes(postElement) || 0,
        comments: (await this.extractComments(postElement)) || [],
        extraction_success: !!postText
      };
    } catch (error) {
      console.error('Lỗi khi trích xuất dữ liệu bài viết:', error);
      return null;
    }
  }

  /**
   * Extract timestamp from post
   */
  extractTimestamp(postElement) {
    try {
      // Multiple selector strategies for timestamps
      const timestampSelectors = [
        'a[href*="/posts/"] span',
        'a[href*="/posts/"]',
        'a[href*="/permalink/"] span',
        'a[href*="/permalink/"]',
        'abbr[data-utime]',
        // New selectors for updated Facebook structure
        'span.x4k7w5x a span',
        'a.x1i10hfl span.x4k7w5x',
        'a.x1i10hfl span.x1hlliex',
        'a[href*="posts"] .x1i10hfl'
      ];

      for (const selector of timestampSelectors) {
        try {
          const elements = postElement.querySelectorAll(selector);
          for (const el of elements) {
            // If it's an abbr with unix timestamp
            if (el.tagName === 'ABBR' && el.getAttribute('data-utime')) {
              const unixTime = parseInt(el.getAttribute('data-utime'));
              if (!isNaN(unixTime)) {
                return new Date(unixTime * 1000).toISOString();
              }
            }

            // If it's a text timestamp
            const text = el.textContent.trim();
            if (
              text &&
              (text.includes('hr') ||
                text.includes('min') ||
                text.includes('sec') ||
                text.includes('giờ') ||
                text.includes('phút') ||
                text.includes('giây') ||
                text.match(/\d+[hms]/))
            ) {
              return new Date().toISOString();
            }
          }
        } catch (e) {
          // Skip failed selectors
        }
      }

      return new Date().toISOString();
    } catch (e) {
      return new Date().toISOString();
    }
  }

  /**
   * Extract images from post with improved detection and error handling
   */
  extractImages(postElement) {
    if (!postElement) return [];

    const images = [];
    try {
      // Safely query selector with error handling
      const safeQuerySelector = (element, selector) => {
        try {
          return element.querySelectorAll(selector);
        } catch (e) {
          // Invalid selector syntax, return empty array
          return [];
        }
      };

      // Safely get attribute
      const safeGetAttribute = (element, attribute) => {
        try {
          return element.getAttribute(attribute);
        } catch (e) {
          return null;
        }
      };

      // SECTION 1: Images in photo.php links
      const photoLinks = safeQuerySelector(
        postElement,
        'a[href*="photo.php"] img'
      );
      for (let i = 0; photoLinks && i < photoLinks.length; i++) {
        try {
          const img = photoLinks[i];
          const src = safeGetAttribute(img, 'src') || img.src;

          if (
            src &&
            !src.includes('emoji') &&
            !src.includes('reaction') &&
            !images.includes(src)
          ) {
            images.push(src);
          }
        } catch (e) {
          // Silent error for individual images
        }
      }

      // SECTION 2: Standard image tags with size filters
      const allImages = safeQuerySelector(postElement, 'img');
      for (let i = 0; allImages && i < allImages.length; i++) {
        try {
          const img = allImages[i];
          const src = safeGetAttribute(img, 'src') || img.src;

          if (
            !src ||
            src.includes('emoji') ||
            src.includes('reaction') ||
            images.includes(src)
          ) {
            continue;
          }

          // Try to get dimensions
          let width =
            parseInt(safeGetAttribute(img, 'width')) || img.width || 0;
          let height =
            parseInt(safeGetAttribute(img, 'height')) || img.height || 0;

          // Check classes for content images
          let imgClass = (safeGetAttribute(img, 'class') || '').toLowerCase();

          const isLikelyContentImage =
            imgClass.includes('image') ||
            imgClass.includes('photo') ||
            imgClass.includes('img') ||
            width >= 350 ||
            height >= 200;

          if (isLikelyContentImage) {
            images.push(src);
          }
        } catch (imgError) {
          // Skip problematic images
        }
      }

      // SECTION 3: Modern Facebook image selectors
      const modernSelectors = [
        '[data-visualcompletion="media-vc-image"]',
        '.x1bwycvy img',
        '.xz74otr img',
        'img[data-visualcompletion="media-vc-image"]',
        'div.x3nfvp2 img',
        'a[aria-label*="photo"] img'
      ];

      for (const selector of modernSelectors) {
        const elements = safeQuerySelector(postElement, selector);
        for (let i = 0; elements && i < elements.length; i++) {
          try {
            const img = elements[i];
            const src = safeGetAttribute(img, 'src') || img.src;

            if (src && !images.includes(src)) {
              images.push(src);
            }
          } catch (e) {
            // Skip problematic images
          }
        }
      }

      // SECTION 4: Background images
      const bgElements = safeQuerySelector(
        postElement,
        '[style*="background-image"]'
      );
      for (let i = 0; bgElements && i < bgElements.length; i++) {
        try {
          const el = bgElements[i];
          if (!el.style || !el.style.backgroundImage) continue;

          const bgImage = el.style.backgroundImage;
          if (!bgImage.includes('url')) continue;

          const match = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
          if (match && match[1] && !images.includes(match[1])) {
            images.push(match[1]);
          }
        } catch (e) {
          // Skip problematic background images
        }
      }
    } catch (error) {
      console.error('Error extracting images:', error);
    }

    return images;
  }

  /**
   * Extract comments from a post
   * @param {HTMLElement} postElement - The post DOM element
   * @returns {Array} - Array of comment objects
   */
  async extractComments(postElement) {
    if (!postElement) return [];

    const comments = [];
    try {
      // Try to find the comments section
      const commentSelectors = [
        'div[aria-label*="comment"] ul',
        'ul.x1nhvcw1',
        '.x1n2onr6 ul',
        '.x78zum5 ul',
        'div[data-visualcompletion="comment-list"]',
        'form ~ ul'
      ];

      let commentSection = null;
      for (const selector of commentSelectors) {
        try {
          const sections = postElement.querySelectorAll(selector);
          if (sections && sections.length > 0) {
            // Take the last one, which is usually the comments list
            commentSection = sections[sections.length - 1];
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }

      if (!commentSection) {
        // Try to expand comments first if there's a "view more comments" button
        const viewMoreBtns = postElement.querySelectorAll(
          'div[role="button"]:not([aria-expanded="false"])'
        );
        for (const btn of viewMoreBtns) {
          if (
            btn.textContent.includes('comment') ||
            btn.textContent.includes('bình luận') ||
            btn.textContent.includes('View') ||
            btn.textContent.includes('Xem')
          ) {
            try {
              btn.click();
              // Give time for comments to load
              await new Promise((resolve) => setTimeout(resolve, 500));
              // Try to find comments section again
              for (const selector of commentSelectors) {
                const sections = postElement.querySelectorAll(selector);
                if (sections && sections.length > 0) {
                  commentSection = sections[sections.length - 1];
                  break;
                }
              }
            } catch (e) {
              // Ignore errors when clicking
            }
          }
        }
      }

      // If we found a comment section, extract comments
      if (commentSection) {
        const commentItems = commentSection.querySelectorAll('li');
        this.log(`Found ${commentItems.length} comments`);

        for (const item of commentItems) {
          try {
            // Extract comment author
            let authorElement = item.querySelector('a[role="link"]');
            const authorName = authorElement
              ? authorElement.textContent.trim()
              : 'Unknown';
            const authorProfileUrl = authorElement ? authorElement.href : null;

            // Extract comment text
            const contentSelectors = [
              'div[dir="auto"]',
              'span[dir="auto"]',
              '.xdj266r',
              '[data-ad-comet-preview="message"]'
            ];

            let commentText = '';
            for (const selector of contentSelectors) {
              const textEl = item.querySelector(selector);
              if (textEl && textEl.textContent.trim()) {
                commentText = textEl.textContent.trim();
                break;
              }
            }

            // Skip empty comments
            if (!commentText) continue;

            // Extract timestamp
            let timestamp = 'Unknown';
            const timeElement = item.querySelector(
              'a[role="link"] span[dir="auto"]'
            );
            if (timeElement) {
              timestamp = timeElement.textContent.trim();
            }

            // Get comment images
            const images = [];
            const imageElements = item.querySelectorAll(
              'img:not([role="presentation"])'
            );
            for (const img of imageElements) {
              const src = img.src || img.getAttribute('src');
              if (
                src &&
                !src.includes('emoji') &&
                !src.includes('reaction') &&
                !images.includes(src)
              ) {
                images.push(src);
              }
            }

            comments.push({
              author: {
                name: authorName,
                profileUrl: authorProfileUrl
              },
              content: commentText,
              timestamp: timestamp,
              images: images,
              scraped_at: new Date().toISOString()
            });
          } catch (e) {
            console.error('Error extracting comment:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error extracting comments:', error);
    }

    return comments;
  }

  /**
   * Get all posts currently visible in the feed (optimized)
   */
  getPosts() {
    try {
      // Log để debug
      console.log('Bắt đầu tìm các bài viết...');

      // Tìm feed container
      const feed = document.querySelector('[role="feed"]') || document.body;
      if (!feed) {
        this.log('Không tìm thấy feed');
        return [];
      }
      this.log('Đã tìm thấy feed, đang trích xuất bài viết');

      // Selector chính xác hơn cho bài viết Facebook dựa trên cấu trúc HTML thực tế
      const selectors = [
        // Selector chính: article element nhưng không phải comment
        '[role="article"]:not([aria-label*="Comment"])',
        '[role="article"]:not([aria-label*="Bình luận"])',

        // Thêm các selector đơn giản hơn từ cấu trúc HTML thực tế
        'div[role="article"]',
        '.x1n2onr6.x1ye3gou.x1iorvi4.x78zum5',

        // Các selector dự phòng dựa trên cấu trúc HTML
        'div.x1yztbdb:not([aria-label*="Comment"])',
        'div.x1n2onr6.x1ja2u2z:has(div.x78zum5.xdt5ytf)',
        'div.x9f619.x1n2onr6.x1ja2u2z:not([role="button"])',

        // Các selector cũ vẫn giữ lại
        'div.x1lliihq:has(div[data-ad-comet-preview="message"])',
        'div.x78zum5:has(div[dir="auto"][style*="text-align"])',
        'div.xexx8yu:has(a[role="link"])'
      ];

      // Sử dụng mảng để lưu trữ kết quả và xử lý sau này
      const postElements = [];

      // Thử từng selector
      selectors.forEach((selector) => {
        try {
          const elements = feed.querySelectorAll(selector);
          console.log(
            `Selector "${selector}" tìm thấy ${elements.length} phần tử`
          );

          elements.forEach((el) => {
            // Bỏ qua các phần tử nhỏ (có thể là comment, button, etc)
            if (el.offsetHeight > 100) {
              // Log ra để debugging
              console.log('Phần tử tìm thấy:', {
                height: el.offsetHeight,
                text: el.textContent.substring(0, 100) + '...',
                isArticle:
                  el.hasAttribute('role') &&
                  el.getAttribute('role') === 'article'
              });

              // Kiểm tra xem có phải bình luận không
              const isComment =
                el.getAttribute('aria-label')?.includes('Comment') ||
                el.getAttribute('aria-label')?.includes('Bình luận') ||
                el.textContent.includes('View more comments') ||
                el.textContent.includes('Xem thêm bình luận');

              // Kiểm tra có phải là bài viết hợp lệ hoặc có nội dung đủ dài
              const hasContent = el.textContent.length > 100;

              if (!isComment && hasContent && !postElements.includes(el)) {
                postElements.push(el);
              }
            }
          });
        } catch (error) {
          console.error(`Lỗi với selector ${selector}:`, error);
        }
      });

      this.log(`Tìm thấy ${postElements.length} bài viết tiềm năng`);

      // Xử lý các bài viết tìm thấy
      const processQueue = [];
      for (const element of postElements) {
        const id = this.extractPostId(element);
        if (id && !this.processedIds.has(id)) {
          this.processedIds.add(id);
          processQueue.push({ element, id });

          if (this.debugMode) {
            element.setAttribute('data-fb-scraper', 'processed');
            setTimeout(() => {
              element.removeAttribute('data-fb-scraper');
            }, 1000);
          }
        }
      }

      // Xử lý ngay một số bài viết
      if (processQueue.length > 0) {
        const initialBatch = processQueue.splice(
          0,
          Math.min(3, processQueue.length)
        );

        for (const { element, id } of initialBatch) {
          this.extractPostData(element).then((post) => {
            if (post) this.scrapedPosts.push(post);
          });
        }

        // Xử lý các bài viết còn lại trong background nếu cần
        if (processQueue.length > 0) {
          setTimeout(() => {
            this.processRemainingPosts(processQueue);
          }, 100);
        }
      }

      // ĐÂY LÀ PHẦN QUAN TRỌNG - trả về kết quả của hàm
      return postElements;
    } catch (error) {
      console.error('Lỗi khi lấy bài viết:', error);
      return [];
    }
  }

  /**
   * Process remaining posts in the background
   */
  processRemainingPosts(queue) {
    // Process in small batches to keep UI responsive
    const batch = queue.splice(0, 3);

    batch.forEach(({ element, id }) => {
      const post = this.extractPostData(element);
      if (post) {
        this.scrapedPosts.push(post);

        // For debugging
        if (this.debugMode) {
          // Highlight scraped posts temporarily
          element.setAttribute('data-fb-scraper', 'processed-background');
          setTimeout(() => {
            element.removeAttribute('data-fb-scraper');
          }, 500);
        }
      }
    });

    // If more remain, schedule next batch
    if (queue.length > 0) {
      setTimeout(() => {
        this.processRemainingPosts(queue);
      }, 100);
    } else if (
      this.isCollecting &&
      this.scrapedPosts.length >= this.postsToCollect
    ) {
      // We have enough posts, finish collection
      this.finishCollection();
    }
  }

  /**
   * Finish collection and return results
   */
  finishCollection() {
    if (!this.isCollecting) return;

    this.log(`Finishing collection with ${this.scrapedPosts.length} posts`);

    // Clean up
    if (this.observer) {
      this.observer.disconnect();
    }

    if (this.sentinelElement && this.sentinelElement.parentNode) {
      this.sentinelElement.parentNode.removeChild(this.sentinelElement);
    }

    // Prepare result
    const result = {
      group: this.groupInfo,
      posts: this.scrapedPosts.slice(0, this.postsToCollect),
      totalScraped: this.scrapedPosts.length,
      isComplete: true,
      lastSaved: new Date().toISOString()
    };

    // Save both to localStorage entries - one for state management, one for data retrieval
    try {
      localStorage.setItem('fb-scraper-last-result', JSON.stringify(result));
      localStorage.setItem('fb-scraper-progress-data', JSON.stringify(result));
      this.log('Results saved to localStorage for backup');
    } catch (e) {
      this.log('Error saving to localStorage:', e.message);
    }

    this.isCollecting = false;

    // Notify background script with error handling
    try {
      chrome.runtime.sendMessage(
        {
          action: 'scrapingComplete',
          data: result
        },
        (response) => {
          if (chrome.runtime.lastError) {
            this.log('Error in messaging:', chrome.runtime.lastError.message);
            // Fallback: Create a download link directly in the page
            this.createDownloadLink(result);
          }
        }
      );
    } catch (e) {
      this.log('Error sending completion message:', e.message);
      // Fallback: Create a download link directly in the page
      this.createDownloadLink(result);
    }

    return result;
  }

  /**
   * Create a download link in the page as fallback
   */
  createDownloadLink(data) {
    try {
      // Create container
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.bottom = '10px';
      container.style.right = '10px';
      container.style.backgroundColor = '#f0f2f5';
      container.style.padding = '10px';
      container.style.borderRadius = '8px';
      container.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
      container.style.zIndex = '9999';
      container.style.maxWidth = '300px';

      // Add message
      const message = document.createElement('p');
      message.textContent =
        'Extension messaging failed. Click below to download data:';
      message.style.margin = '0 0 10px 0';
      container.appendChild(message);

      // Create download link
      const link = document.createElement('a');
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      });
      link.href = URL.createObjectURL(blob);
      link.download = `facebook_group_${
        data.group?.id || 'data'
      }_${new Date().getTime()}.json`;
      link.textContent = 'Download Scraped Data';
      link.style.display = 'inline-block';
      link.style.padding = '8px 16px';
      link.style.backgroundColor = '#1877f2';
      link.style.color = 'white';
      link.style.borderRadius = '4px';
      link.style.textDecoration = 'none';
      link.style.fontWeight = 'bold';
      container.appendChild(link);

      // Add close button
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.style.marginLeft = '10px';
      closeBtn.style.padding = '8px 16px';
      closeBtn.style.border = 'none';
      closeBtn.style.borderRadius = '4px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.onclick = () => document.body.removeChild(container);
      container.appendChild(closeBtn);

      // Add to page
      document.body.appendChild(container);
    } catch (e) {
      console.error('Failed to create download link:', e);
    }
  }

  /**
   * Start collecting posts with optimizations
   */
  async startCollecting(count = 50) {
    if (this.isCollecting) return;

    console.log('=== BẮT ĐẦU QUÁ TRÌNH SCRAPE ===');
    console.log('- Trạng thái ban đầu:', {
      isCollecting: this.isCollecting,
      isPaused: this.isPaused,
      postsCount: this.scrapedPosts.length,
      debugMode: this.debugMode
    });
    console.log('- Kiểm tra DOM:', {
      feedExists: !!document.querySelector('[role="feed"]'),
      articleElements: document.querySelectorAll('[role="article"]').length,
      bodyContent: document.body.children.length
    });

    // Đặt thêm thời gian chờ cho DOM load hoàn toàn
    console.log('- Đợi DOM tải hoàn toàn...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.isCollecting = true;
    this.isPaused = false;
    this.postsToCollect = count;
    this.scrapedPosts = [];
    this.processedIds = new Set();
    this.lastLoadTime = 1000;
    this.extractGroupInfo();

    // Add style for debugging
    if (this.debugMode) {
      const style = document.createElement('style');
      style.id = 'fb-scraper-style';
      style.textContent = `
        [data-fb-scraper="processed"] {
          outline: 2px solid #4CAF50 !important;
        }
        [data-fb-scraper="processed-background"] {
          outline: 2px solid #2196F3 !important;
        }
      `;
      document.head.appendChild(style);
    }

    this.log(`Starting collection of ${count} posts`);

    // Set up observer for efficient scrolling
    this.setupIntersectionObserver();

    // Get initial posts
    this.getPosts();

    // Add backup timer to ensure scrolling continues even if observer fails
    this.backupScrollTimer = setInterval(() => {
      if (
        this.isCollecting &&
        !this.isPaused &&
        !this.isLoading &&
        this.scrapedPosts.length < this.postsToCollect
      ) {
        this.log('Backup timer triggering scroll');
        this.loadMoreContent();
      }
    }, 5000); // Check every 5 seconds

    // Set up progress monitoring with error handling
    this.progressInterval = setInterval(() => {
      const currentCount = this.scrapedPosts.length;
      this.log(`Progress: ${currentCount}/${this.postsToCollect} posts`);

      // Save current state
      this.saveState();

      // Save current scraping data for potential download
      this.saveCurrentProgress();

      // Store current progress in localStorage as backup
      try {
        localStorage.setItem(
          'fb-scraper-progress',
          JSON.stringify({
            current: currentCount,
            total: this.postsToCollect,
            timestamp: Date.now()
          })
        );
      } catch (e) {
        this.log('Error saving progress to localStorage');
      }

      // Send progress update to popup with error handling
      try {
        chrome.runtime.sendMessage(
          {
            action: 'scrapingProgress',
            data: {
              current: currentCount,
              total: this.postsToCollect
            }
          },
          (response) => {
            // If there's an error like "Extension context invalidated",
            // the callback won't be called, so we don't need to check
            // chrome.runtime.lastError here
          }
        );
      } catch (e) {
        this.log('Error sending progress update, continuing scraping');
        // Continue scraping even if messaging fails
      }

      if (currentCount >= this.postsToCollect) {
        clearInterval(this.progressInterval);
        this.finishCollection();
      }
    }, 1000); // Update every second

    // Start initial loading if needed
    if (this.scrapedPosts.length < this.postsToCollect) {
      this.loadMoreContent();
    }
  }

  /**
   * Pause collecting
   */
  pauseCollection() {
    if (!this.isCollecting) return;
    this.isPaused = true;
    this.log('Collection paused');
  }

  /**
   * Resume collecting
   */
  resumeCollection() {
    if (!this.isCollecting) return;
    this.isPaused = false;
    this.log('Collection resumed');

    // Continue loading content
    if (this.scrapedPosts.length < this.postsToCollect) {
      this.loadMoreContent();
    }
  }

  /**
   * Stop collecting posts
   */
  stopCollecting() {
    this.isCollecting = false;
    this.isPaused = false;

    // Clean up
    if (this.observer) {
      this.observer.disconnect();
    }

    if (this.sentinelElement && this.sentinelElement.parentNode) {
      this.sentinelElement.parentNode.removeChild(this.sentinelElement);
    }

    clearInterval(this.progressInterval);
    clearInterval(this.backupScrollTimer); // Clear backup timer

    // Remove debugging styles
    const style = document.getElementById('fb-scraper-style');
    if (style) {
      style.parentNode.removeChild(style);
    }

    this.log('Collection stopped');
  }

  /**
   * Save current scraping state to localStorage
   */
  saveState() {
    try {
      const state = {
        isCollecting: this.isCollecting,
        isPaused: this.isPaused,
        postsToCollect: this.postsToCollect,
        scrapedPostsCount: this.scrapedPosts.length,
        lastUpdated: new Date().toISOString()
      };

      localStorage.setItem('fb-scraper-state', JSON.stringify(state));
    } catch (e) {
      this.log('Error saving state to localStorage');
    }
  }

  /**
   * Save current progress to localStorage for download anytime
   * @private
   */
  saveCurrentProgress() {
    try {
      const partialResult = {
        group: this.groupInfo,
        posts: this.scrapedPosts.slice(), // Create a copy of the current posts array
        totalScraped: this.scrapedPosts.length,
        isComplete: false,
        lastSaved: new Date().toISOString()
      };

      localStorage.setItem(
        'fb-scraper-progress-data',
        JSON.stringify(partialResult)
      );
      this.log(`Saved ${this.scrapedPosts.length} posts to localStorage`);
    } catch (e) {
      this.log('Error saving partial data to localStorage:', e.message);
    }
  }
}

// Create global instance
window.facebookScraper = new FacebookScraper();
