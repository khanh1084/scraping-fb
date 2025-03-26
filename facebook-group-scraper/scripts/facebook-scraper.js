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
    this.cleanupInterval = null;
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

    // Thêm phát hiện chặn scraping
    const oldHeight = document.documentElement.scrollHeight;

    // Wait for content to load
    await new Promise((resolve) => setTimeout(resolve, timeout));

    // Kiểm tra nếu không có nội dung mới được tải
    const newHeight = document.documentElement.scrollHeight;
    if (
      oldHeight === newHeight &&
      this.lastScrapedCount === this.scrapedPosts.length
    ) {
      this.consecutiveNoNewContentCount =
        (this.consecutiveNoNewContentCount || 0) + 1;

      if (this.consecutiveNoNewContentCount >= 3) {
        console.warn(
          'Có thể Facebook đang chặn việc scraping - không có nội dung mới được tải sau 3 lần'
        );
        // Có thể tạm dừng hoặc giảm tốc độ scraping
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Đợi thêm
      }
    } else {
      this.consecutiveNoNewContentCount = 0;
    }

    this.lastScrapedCount = this.scrapedPosts.length;

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
   * Extract post ID with more reliable methods
   */
  extractPostId(postElement) {
    try {
      // Method 1: From Facebook's own post ID in the data attributes
      let postId = null;

      // Try data-ft attribute first (most reliable)
      const dataFt = postElement.getAttribute('data-ft');
      if (dataFt) {
        try {
          const parsed = JSON.parse(dataFt);
          if (parsed.top_level_post_id) {
            return parsed.top_level_post_id;
          } else if (parsed.content_owner_id_new) {
            return parsed.content_owner_id_new;
          }
        } catch (e) {
          // Continue to other methods
        }
      }

      // Method 2: From post permalinks
      const permalinkSelectors = [
        'a[href*="/permalink/"]',
        'a[href*="/posts/"]',
        'a[href*="story_fbid="]'
      ];

      for (const selector of permalinkSelectors) {
        const link = postElement.querySelector(selector);
        if (link && link.href) {
          // Try /permalink/ID/ pattern
          let match = link.href.match(/\/permalink\/(\d+)/);
          if (match && match[1]) return match[1];

          // Try /posts/ID/ pattern
          match = link.href.match(/\/posts\/(\d+)/);
          if (match && match[1]) return match[1];

          // Try story_fbid=ID pattern
          match = link.href.match(/story_fbid=(\d+)/);
          if (match && match[1]) return match[1];
        }
      }

      // Method 3: Content-based fingerprint as last resort
      // Create a "fingerprint" based on content to identify duplicates
      const contentFingerprint = this.createContentFingerprint(postElement);
      if (contentFingerprint) {
        return `content_${contentFingerprint}`;
      }

      return `generated_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}`;
    } catch (error) {
      console.error('Error extracting post ID:', error);
      return `generated_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 10)}`;
    }
  }

  /**
   * Create a content fingerprint for duplicate detection
   */
  createContentFingerprint(postElement) {
    try {
      // Get text content of the post, limited to first 100 chars for efficiency
      const text = postElement.textContent.slice(0, 100).trim();

      // Get author name if possible
      let authorName = '';
      const authorEl = postElement.querySelector(
        'h3 a, h4 a, a[role="link"][tabindex="0"]'
      );
      if (authorEl) {
        authorName = authorEl.textContent.trim();
      }

      // Create a composite string to hash
      const compositeString = `${authorName}_${text}`;

      // Use a simple hash function
      let hash = 0;
      for (let i = 0; i < compositeString.length; i++) {
        const char = compositeString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
      }

      return Math.abs(hash).toString(16);
    } catch (e) {
      return null;
    }
  }

  /**
   * Simple string hash function for content-based IDs
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; str.length; i++) {
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
      console.log('Đang xử lý bài viết với phương pháp mạnh hơn!');

      // 1. Lấy ID của bài viết trước
      const postId =
        this.extractPostId(postElement) || `generated_${Date.now()}`;

      // 2. Sử dụng phương pháp kết hợp mạnh nhất để lấy nội dung
      const postText = await this.extractAllContent(postElement);

      console.log(
        `Đã trích xuất ${postText ? postText.length : 0} ký tự nội dung`
      );

      // 3. Trích xuất các thông tin khác
      return {
        postId,
        content: postText || '[No content extracted]',
        author: this.extractAuthor(postElement) || {
          name: 'Unknown',
          id: null,
          profileUrl: null
        },
        timestamp:
          this.extractTimestamp(postElement) || new Date().toISOString(),
        images: this.extractImages(postElement) || [],
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
   * Get all posts with improved duplicate detection
   */
  getPosts() {
    try {
      // Find feed element
      const feed =
        document.querySelector('[role="feed"]') ||
        document.querySelector('[data-pagelet="GroupFeed"]') ||
        document.body;

      if (!feed) {
        console.error('Feed element not found');
        return [];
      }

      // Use dynamically determined selectors
      const selectors = this.postSelectors || [
        '[role="article"]:not([aria-label*="Comment"]):not([aria-label*="Bình luận"])'
      ];

      // Sử dụng Set để lưu trữ các phần tử duy nhất dựa trên ID
      const uniquePosts = new Map();

      // Thử từng selector
      for (const selector of selectors) {
        try {
          const elements = feed.querySelectorAll(selector);
          this.log(
            `Selector "${selector}" tìm thấy ${elements.length} phần tử`
          );

          for (const el of elements) {
            // Bỏ qua các phần tử nhỏ (có thể là comment, button, etc)
            if (el.offsetHeight < 100) continue;

            // Kiểm tra xem có phải bình luận không
            const isComment =
              el.getAttribute('aria-label')?.includes('Comment') ||
              el.getAttribute('aria-label')?.includes('Bình luận') ||
              el.textContent.includes('View more comments') ||
              el.textContent.includes('Xem thêm bình luận');

            if (isComment) continue;

            // Lấy ID của bài viết
            const postId = this.extractPostId(el);

            if (postId && !this.processedIds.has(postId)) {
              // Thêm bài viết vào danh sách và đánh dấu đã xử lý
              this.processedIds.add(postId);

              // Lưu bài viết vào map với postId làm khóa để đảm bảo duy nhất
              if (!uniquePosts.has(postId)) {
                uniquePosts.set(postId, { element: el, id: postId });

                // Debug visualization
                if (this.debugMode) {
                  el.setAttribute('data-fb-scraper', 'processed');
                  setTimeout(() => {
                    el.removeAttribute('data-fb-scraper');
                  }, 1000);
                }
              }
            }
          }
        } catch (error) {
          console.error(`Lỗi với selector ${selector}:`, error);
        }
      }

      // Chuyển map thành mảng để xử lý
      const processQueue = Array.from(uniquePosts.values());
      this.log(`Tìm thấy ${processQueue.length} bài viết duy nhất`);

      // Xử lý các bài viết
      if (processQueue.length > 0) {
        const initialBatch = processQueue.splice(
          0,
          Math.min(3, processQueue.length)
        );
        for (const { element, id } of initialBatch) {
          this.extractPostData(element).then((post) => {
            if (post) {
              this.scrapedPosts.push(post);
            }
          });
        }

        // Xử lý những bài còn lại theo queue
        if (processQueue.length > 0) {
          setTimeout(() => this.processRemainingPosts(processQueue), 200);
        }
      }

      return processQueue.map((p) => p.element);
    } catch (error) {
      console.error('Error getting posts:', error);
      return [];
    }
  }

  /**
   * Process remaining posts in the background
   */
  processRemainingPosts(queue) {
    // Xử lý theo batch lớn hơn để giảm số lần gọi hàm
    const batch = queue.splice(0, 5); // Tăng từ 3 lên 5

    Promise.all(
      batch.map(async ({ element, id }) => {
        const post = await this.extractPostData(element);
        if (post) {
          this.scrapedPosts.push(post);
          // Highlighting code...
        }
      })
    ).then(() => {
      if (queue.length > 0) {
        setTimeout(() => this.processRemainingPosts(queue), 100);
      } else if (
        this.isCollecting &&
        this.scrapedPosts.length >= this.postsToCollect
      ) {
        this.finishCollection();
      }
    });
  }

  /**
   * Finish collection and save results
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

    clearInterval(this.cleanupInterval);

    // Remove duplicate posts
    this.removeDuplicatePosts();

    // Prepare result
    const result = {
      group: this.groupInfo,
      posts: this.scrapedPosts.slice(0, this.postsToCollect),
      totalScraped: this.scrapedPosts.length,
      isComplete: true,
      lastSaved: new Date().toISOString()
    };

    // Save to multiple localStorage entries for redundancy
    try {
      // Save to both keys for compatibility and redundancy
      localStorage.setItem('fb-scraper-last-result', JSON.stringify(result));
      localStorage.setItem('fb-scraper-progress-data', JSON.stringify(result));
      localStorage.setItem('fb-scraper-result', JSON.stringify(result));
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

      // Also send with legacy action name for backward compatibility
      chrome.runtime.sendMessage({
        action: 'scraperResult',
        result: result
      });
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

    // Detect and adapt to group layout
    this.postSelectors = this.detectGroupLayout();
    console.log('Using post selectors:', this.postSelectors);

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

    this.cleanupInterval = setInterval(() => {
      if (this.scrapedPosts.length > this.postsToCollect * 1.5) {
        // Giữ lại số bài viết mới nhất cần thiết
        this.scrapedPosts = this.scrapedPosts.slice(-this.postsToCollect);
        console.log(
          'Đã dọn dẹp bộ nhớ, giữ lại',
          this.scrapedPosts.length,
          'bài viết'
        );
      }
    }, 10000);
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
    clearInterval(this.cleanupInterval);

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

  /**
   * Phương pháp trích xuất nội dung mạnh hơn từ bài đăng Facebook
   * @param {HTMLElement} postElement - Phần tử DOM của bài đăng
   * @returns {string} - Nội dung bài đăng đã trích xuất
   */
  extractPostContentAdvanced(postElement) {
    if (!postElement) return '';

    try {
      console.log('Bắt đầu trích xuất nội dung nâng cao cho bài viết...');

      // 1. Expand all "See more" buttons first
      this.expandSeemoreButtons(postElement);

      // 2. Try multiple extraction methods and combine results
      const extractedContent = new Set();

      // METHOD 1: Extract from known content containers using multiple passes
      const contentSelectors = [
        'span.x193iq5w', // Selector từ sample_post.html
        'div.xdj266r div.x1e56ztr', // Container phổ biến cho nội dung
        '[data-ad-comet-preview="message"]', // Facebook message preview
        'div[dir="auto"]', // Generic text containers
        'span[dir="auto"]', // Spans with direct text
        'div.x1iorvi4 span', // Latest Facebook content container
        'div.xdj266r span' // Container từ mẫu HTML
      ];

      for (const selector of contentSelectors) {
        try {
          const elements = postElement.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent?.trim();
            // Skip small texts, UI elements, timestamps
            if (
              text &&
              text.length > 30 && // Dài hơn để lấy nội dung chính
              !text.includes('Like') &&
              !text.includes('Comment') &&
              !text.includes('Share') &&
              !text.includes('Thích') &&
              !text.includes('Bình luận') &&
              !text.includes('Chia sẻ') &&
              !text.match(/^\d+\s+(minute|hour|day|phút|giờ|ngày)/)
            ) {
              extractedContent.add(text);
              console.log(
                `Tìm thấy nội dung từ ${selector}:`,
                text.substring(0, 50) + '...'
              );
            }
          }
        } catch (e) {
          console.debug(`Lỗi khi truy vấn selector ${selector}:`, e);
        }
      }

      // METHOD 2: Extract from raw HTML - tìm nội dung bài đăng từ HTML
      try {
        const html = postElement.innerHTML;

        // Tìm JSON data trong HTML
        const jsonPatterns = [
          /"message":\s*{\s*"text":\s*"([^"]+?)"/,
          /"text":\s*"([^"]+?)"/,
          /"story":\s*{\s*"message":\s*{\s*"text":\s*"([^"]+?)"/
        ];

        for (const pattern of jsonPatterns) {
          const matches = html.match(new RegExp(pattern, 'g'));
          if (matches) {
            matches.forEach((match) => {
              const contentMatch = match.match(pattern);
              if (contentMatch && contentMatch[1]) {
                // Decode JSON escape sequences
                const decodedText = contentMatch[1]
                  .replace(/\\n/g, '\n')
                  .replace(/\\"/g, '"')
                  .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
                    String.fromCharCode(parseInt(hex, 16))
                  );

                if (decodedText.length > 30) {
                  extractedContent.add(decodedText);
                  console.log(
                    'Tìm thấy nội dung từ JSON pattern:',
                    decodedText.substring(0, 50) + '...'
                  );
                }
              }
            });
          }
        }
      } catch (e) {
        console.debug('Lỗi khi phân tích HTML:', e);
      }

      // METHOD 3: Deepest text node scan - quét sâu
      try {
        const textNodes = this.getAllTextNodes(postElement);
        const longTextNodes = textNodes.filter((node) => {
          const text = node.textContent?.trim();
          return text && text.length > 60; // Only substantial content
        });

        longTextNodes.forEach((node) => {
          extractedContent.add(node.textContent.trim());
        });

        console.log(
          `Tìm thấy ${longTextNodes.length} text nodes với nội dung dài`
        );
      } catch (e) {
        console.debug('Lỗi khi quét text nodes:', e);
      }

      // METHOD 4: Extract from attributes - một số nội dung ẩn trong attributes
      try {
        const elementsWithAttrs = postElement.querySelectorAll(
          '[aria-label], [data-content], [title]'
        );
        for (const el of elementsWithAttrs) {
          for (const attr of ['aria-label', 'data-content', 'title']) {
            const content = el.getAttribute(attr);
            if (
              content &&
              content.length > 60 &&
              !content.includes('reaction')
            ) {
              extractedContent.add(content);
            }
          }
        }
      } catch (e) {
        console.debug('Lỗi khi trích xuất từ attributes:', e);
      }

      // METHOD 5: Extract from image alt texts - lấy nội dung từ ảnh
      try {
        const images = postElement.querySelectorAll('img[alt]');
        for (const img of images) {
          const alt = img.getAttribute('alt');
          if (
            alt &&
            alt.length > 100 &&
            (alt.includes('.') || alt.match(/[A-Z][a-z]+ [A-Z][a-z]+/))
          ) {
            // Dấu hiệu của một câu/đoạn văn
            extractedContent.add(alt);
            console.log(
              'Tìm thấy nội dung từ alt của ảnh:',
              alt.substring(0, 50) + '...'
            );
          }
        }
      } catch (e) {
        console.debug('Lỗi khi trích xuất từ alt của ảnh:', e);
      }

      // Combine all extracted content, filter duplicates
      const combinedContent = Array.from(extractedContent)
        // Sort by length descending - ưu tiên đoạn dài
        .sort((a, b) => b.length - a.length)
        // Remove near duplicates - bỏ đoạn gần giống nhau
        .filter((text, index, array) => {
          // Skip if this text is a substring of a longer text that appears earlier in the array
          return !array
            .slice(0, index)
            .some(
              (prevText) =>
                prevText.includes(text) && prevText.length > text.length * 1.2
            );
        });

      // Log extraction results
      console.log(`Extracted ${combinedContent.length} content sections`);

      // Join all the pieces with newlines
      return combinedContent.join('\n\n');
    } catch (error) {
      console.error('Error in advanced content extraction:', error);
      return '';
    }
  }

  /**
   * Expand all "See more" buttons in a post element
   */
  async expandSeemoreButtons(postElement) {
    const buttonSelectors = [
      '[role="button"]',
      'div.x1i10hfl[tabindex="0"]',
      'span.x1i10hfl[tabindex="0"]',
      'div.xsdox4t[tabindex="0"]'
    ];

    // Track if we're in a modal view
    let inModalView = false;
    const initialURL = window.location.href;

    // Store document body height to detect modal opening
    const initialHeight = document.body.scrollHeight;

    // Try multiple passes as new buttons may appear after expanding others
    for (let pass = 0; pass < 3; pass++) {
      let expanded = false;

      for (const selector of buttonSelectors) {
        const buttons = postElement.querySelectorAll(selector);
        for (const button of buttons) {
          // Check if it's a "See more" button by text content
          const text = button.textContent.toLowerCase();
          if (
            text.includes('see more') ||
            text.includes('xem thêm') ||
            text.includes('... more') ||
            text.includes('...more')
          ) {
            try {
              console.log('Clicking "See more" button:', text);
              button.click();
              expanded = true;

              // Pause to let content expand or modal open
              await new Promise((resolve) => setTimeout(resolve, 500));

              // Detect if a modal view appeared
              const newHeight = document.body.scrollHeight;
              const urlChanged = window.location.href !== initialURL;

              if (urlChanged || Math.abs(newHeight - initialHeight) > 500) {
                console.log('Detected modal/teleport view opening');
                inModalView = true;

                // Extract content from the modal
                await this.extractFromModalView();

                // Close the modal by pressing Escape key
                try {
                  document.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      key: 'Escape',
                      code: 'Escape',
                      keyCode: 27,
                      which: 27,
                      bubbles: true
                    })
                  );

                  // Wait for modal to close
                  await new Promise((resolve) => setTimeout(resolve, 500));

                  // Reset to initial state
                  inModalView = false;
                } catch (e) {
                  console.error('Error closing modal view:', e);
                }
              }
            } catch (e) {
              console.debug('Error clicking see more button:', e);
            }
          }
        }
      }

      if (!expanded) break; // No more buttons expanded, so exit

      // Wait a bit longer between passes
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /**
   * Extract content from a modal/teleport view
   */
  async extractFromModalView() {
    try {
      console.log('Extracting content from modal view');

      // Modal content is usually in a different DOM structure
      const modalSelectors = [
        '[role="dialog"]',
        '.x1ey2m1c', // Common Facebook modal container
        'div[aria-modal="true"]',
        '.x9f619.x1n2onr6.x1ja2u2z' // Another FB modal class pattern
      ];

      let modalElement = null;

      // Find the modal container
      for (const selector of modalSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          modalElement = element;
          break;
        }
      }

      if (!modalElement) {
        console.log('Could not find modal element');
        return null;
      }

      // Extract post content from modal using our existing methods
      const postElement =
        modalElement.querySelector('[role="article"]') || modalElement;

      if (postElement) {
        // Use our standard extraction methods on this modal content
        const postContent = await this.extractAllContent(postElement);
        const postId = this.extractPostId(postElement);

        if (postContent && postId) {
          // Store this content with its ID so we don't extract it again
          this.processedIds.add(postId);

          // Create a post object for this modal content
          const post = {
            postId,
            content: postContent,
            author: this.extractAuthor(postElement) || {
              name: 'Unknown',
              id: null,
              profileUrl: null
            },
            timestamp:
              this.extractTimestamp(postElement) || new Date().toISOString(),
            images: this.extractImages(postElement) || [],
            likes: this.extractLikes(postElement) || 0,
            comments: (await this.extractComments(postElement)) || [],
            extraction_success: !!postContent,
            from_modal: true // Mark that this came from a modal view
          };

          // Add to our scraped posts
          this.scrapedPosts.push(post);

          console.log('Successfully extracted post from modal view:', postId);
          return post;
        }
      }

      return null;
    } catch (e) {
      console.error('Error extracting from modal view:', e);
      return null;
    }
  }

  /**
   * Get all text nodes from an element recursively
   */
  getAllTextNodes(element) {
    const textNodes = [];

    // Skip certain elements that are unlikely to contain post content
    const skipTags = ['SCRIPT', 'STYLE', 'SVG', 'BUTTON', 'INPUT'];
    const skipRoles = ['button', 'tab', 'menuitem'];
    const skipClass = ['xcm5owa', 'x1le4gvd', 'x78zum5'];

    if (skipTags.includes(element.tagName)) return textNodes;
    if (
      element.getAttribute &&
      skipRoles.includes(element.getAttribute('role'))
    )
      return textNodes;
    if (
      element.className &&
      skipClass.some((cls) => element.className.includes(cls))
    )
      return textNodes;

    // Get text nodes from this element
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const text = node.textContent.trim();
        // Accept non-empty text nodes
        return text ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    return textNodes;
  }

  /**
   * Use XPath to find elements - sometimes more powerful than CSS selectors
   */
  getElementByXPath(xpath, contextNode = document) {
    try {
      const result = document.evaluate(
        xpath,
        contextNode,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      const elements = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        elements.push(result.snapshotItem(i));
      }

      return elements;
    } catch (e) {
      console.debug('XPath error:', e);
      return [];
    }
  }

  /**
   * Extract post content using XPath expressions
   */
  extractContentWithXPath(postElement) {
    const contentPieces = [];

    try {
      // XPath biểu thức cho các phần tử có thể chứa nội dung
      const xpaths = [
        // Text nodes that have substantial content (more than 80 chars)
        './/text()[string-length(normalize-space(.)) > 80]',

        // Div elements with substantial direct text
        './/div[string-length(normalize-space(text())) > 80]',

        // Span elements with substantial text
        './/span[string-length(normalize-space(text())) > 80]',

        // Specific to Facebook content structure
        './/div[contains(@class, "xdj266r")]//span[contains(@class, "x193iq5w")]',

        // Image alt text that may contain content
        './/img[string-length(@alt) > 100]/@alt'
      ];

      for (const xpath of xpaths) {
        const elements = this.getElementByXPath(xpath, postElement);

        for (const el of elements) {
          // For attribute nodes (like @alt)
          if (el.nodeType === 2) {
            // Attribute node
            contentPieces.push(el.value);
            continue;
          }

          // For text or element nodes
          const text = el.textContent?.trim();
          if (
            text &&
            text.length > 40 &&
            !text.includes('Thích') &&
            !text.includes('Like') &&
            !text.includes('Comment')
          ) {
            contentPieces.push(text);
          }
        }
      }
    } catch (e) {
      console.debug('Error in XPath content extraction:', e);
    }

    return contentPieces;
  }

  /**
   * Extract content directly from Facebook's internal data structures
   * This is the most aggressive method that tries to access FB's internal data
   */
  extractFromFacebookInternals() {
    try {
      // Tìm tất cả các script tags trong trang
      const scripts = document.querySelectorAll('script');
      const results = [];

      // Tìm kiếm cấu trúc dữ liệu nội bộ của Facebook
      for (const script of scripts) {
        const text = script.textContent || '';

        // Tìm kiếm các cấu trúc dữ liệu có thể chứa nội dung bài viết
        if (
          text.includes('"story_attachment_style"') ||
          text.includes('"message"') ||
          text.includes('"story":')
        ) {
          // Tìm các đối tượng JSON có khả năng chứa nội dung
          const jsonPattern = /\{"require":\[.+?\],"define":\[.+?\]}/g;
          const jsonMatches = text.match(jsonPattern);

          if (jsonMatches) {
            for (const jsonStr of jsonMatches) {
              try {
                // Phân tích cú pháp JSON
                const data = JSON.parse(jsonStr);

                // Đào sâu vào cấu trúc để tìm nội dung
                this.extractNestedContent(data, results);
              } catch (e) {
                // Bỏ qua lỗi JSON parsing
              }
            }
          }
        }
      }

      return results;
    } catch (error) {
      console.error('Error extracting from Facebook internals:', error);
      return [];
    }
  }

  /**
   * Đào sâu vào các cấu trúc JSON để tìm nội dung
   */
  extractNestedContent(obj, results, depth = 0) {
    // Giới hạn độ sâu để tránh đệ quy vô hạn
    if (depth > 10) return;

    try {
      // Nếu là mảng, duyệt qua từng phần tử
      if (Array.isArray(obj)) {
        for (const item of obj) {
          this.extractNestedContent(item, results, depth + 1);
        }
        return;
      }

      // Nếu không phải object, bỏ qua
      if (!obj || typeof obj !== 'object') return;

      // Kiểm tra các thuộc tính quan trọng
      for (const key in obj) {
        // Tìm các khóa liên quan đến nội dung
        if (
          ['text', 'message', 'content', 'body', 'description'].includes(key)
        ) {
          const value = obj[key];

          // Nếu là string và đủ dài, đây có thể là nội dung
          if (typeof value === 'string' && value.length > 50) {
            results.push(value);
          }
          // Nếu là object và có text, đây có thể là nội dung có định dạng
          else if (value && typeof value === 'object' && value.text) {
            if (typeof value.text === 'string' && value.text.length > 50) {
              results.push(value.text);
            }
          }
        }

        // Đào sâu hơn vào các thuộc tính khác
        this.extractNestedContent(obj[key], results, depth + 1);
      }
    } catch (e) {
      // Bỏ qua lỗi
    }
  }

  /**
   * Master method that combines all extraction techniques
   */
  async extractAllContent(postElement) {
    // Array to hold content from all methods
    const allContent = new Set();

    // Method 1: Standard method
    const standardContent = this.extractPostContentAdvanced(postElement);
    if (standardContent) {
      standardContent.split('\n\n').forEach((text) => allContent.add(text));
    }

    // Method 2: XPath method
    const xpathContent = this.extractContentWithXPath(postElement);
    xpathContent.forEach((text) => allContent.add(text));

    // Method 3: Try to access Facebook internals
    const internalContent = this.extractFromFacebookInternals();
    internalContent.forEach((text) => allContent.add(text));

    // Sort by length (longest first) and filter duplicates
    return Array.from(allContent)
      .sort((a, b) => b.length - a.length)
      .filter((text, index, array) => {
        // Remove near-duplicates
        const isDuplicate = array.slice(0, index).some((prevText) => {
          // If this text is mostly contained in a previous longer text
          if (prevText.length > text.length * 1.2) {
            return (
              prevText.includes(text) ||
              this.calculateSimilarity(prevText, text) > 0.85
            );
          }
          return false;
        });
        return !isDuplicate;
      })
      .join('\n\n');
  }

  /**
   * Calculate similarity between two strings (simple implementation)
   */
  calculateSimilarity(str1, str2) {
    // Quick check for very different length strings
    if (
      Math.abs(str1.length - str2.length) / Math.max(str1.length, str2.length) >
      0.3
    ) {
      return 0;
    }

    // Simple similarity based on common words
    const words1 = str1.toLowerCase().split(/\W+/);
    const words2 = str2.toLowerCase().split(/\W+/);

    // Create sets of unique words
    const set1 = new Set(words1);
    const set2 = new Set(words2);

    // Count common words
    let common = 0;
    for (const word of set1) {
      if (set2.has(word)) common++;
    }

    // Return Jaccard similarity
    return common / (set1.size + set2.size - common);
  }

  /**
   * Extract author information from a post
   * @param {HTMLElement} postElement - The post DOM element
   * @returns {Object} Author info
   */
  extractAuthor(postElement) {
    try {
      // Nhiều chiến lược selector khác nhau cho author
      const authorSelectors = [
        'h3 a',
        'h4 a',
        'h2 a',
        '[role="link"][tabindex="0"]',
        'a[role="link"][tabindex="0"]',
        'a.x1i10hfl[href*="/user/"]', // User links
        'span.x193iq5w a', // Modern FB structure
        'a[aria-label]:not([aria-label*="comment"])', // Links with labels
        '.x1heor9g a', // New FB post header structure
        '.x1y1aw1k a' // Another FB post header class
      ];

      let authorElement = null;
      for (const selector of authorSelectors) {
        try {
          const elements = postElement.querySelectorAll(selector);
          for (const el of elements) {
            // Bỏ qua links đến ảnh hoặc nút like/comment
            if (
              el.href &&
              !el.href.includes('photo.php') &&
              !el.href.includes('reaction') &&
              !el.textContent.includes('Like') &&
              !el.textContent.includes('Comment')
            ) {
              authorElement = el;
              break;
            }
          }
          if (authorElement) break;
        } catch (e) {
          // Bỏ qua selector lỗi
        }
      }

      if (!authorElement) {
        console.log('Không tìm thấy tác giả, dùng "Unknown"');
        return {
          name: 'Unknown',
          id: null,
          profileUrl: null
        };
      }

      const authorName = authorElement.textContent.trim();
      const authorProfileUrl = authorElement.href || null;
      let authorId = null;

      // Trích xuất ID từ URL profile
      if (authorProfileUrl) {
        const authorIdMatch = authorProfileUrl.match(
          /\/(?:profile\.php\?id=(\d+)|([^?/]+))/
        );
        if (authorIdMatch) {
          authorId = authorIdMatch[1] || authorIdMatch[2];
        }
      }

      return {
        name: authorName || 'Unknown',
        id: authorId,
        profileUrl: authorProfileUrl
      };
    } catch (error) {
      console.error('Lỗi khi trích xuất thông tin tác giả:', error);
      return {
        name: 'Unknown',
        id: null,
        profileUrl: null
      };
    }
  }

  /**
   * Extract likes/reactions count from a post
   * @param {HTMLElement} postElement - The post DOM element
   * @returns {number} Number of reactions
   */
  extractLikes(postElement) {
    try {
      // Multiple selector strategies for reactions
      const reactionSelectors = [
        '[aria-label*="reactions"]',
        '[aria-label*="like"]',
        '[aria-label*="thích"]',
        'span[data-testid="like"]',
        'div[data-testid="UFI2ReactionsCount"]',
        '.x16hj40l span', // Modern FB reaction counter
        'span.x193iq5w span.xt0psk2', // Another reaction counter format
        'span.x1e558r4' // Yet another reaction structure
      ];

      for (const selector of reactionSelectors) {
        try {
          const elements = postElement.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.getAttribute('aria-label') || el.textContent;
            // Tìm kiếm số lượng trong text
            const match = text.match(/(\d+)/);
            if (match) {
              return parseInt(match[0], 10);
            }
          }
        } catch (e) {
          // Skip failed selectors
        }
      }

      return 0; // Mặc định 0 nếu không tìm thấy
    } catch (error) {
      console.error('Lỗi khi trích xuất số lượng thích:', error);
      return 0;
    }
  }

  /**
   * Loại bỏ các bài trùng lặp trước khi lưu
   */
  removeDuplicatePosts() {
    const seen = new Set();
    this.scrapedPosts = this.scrapedPosts.filter((post) => {
      // Sử dụng content làm "fingerprint" nếu không có postId
      const uniqueKey =
        post.postId ||
        this.createContentFingerprint({ textContent: post.content });

      // Trả về false nếu đã thấy key này, true nếu chưa thấy
      if (seen.has(uniqueKey)) {
        return false;
      } else {
        seen.add(uniqueKey);
        return true;
      }
    });

    this.log(`Sau khi loại bỏ trùng lặp: ${this.scrapedPosts.length} bài viết`);
  }

  /**
   * Detect and adapt to different Facebook group layouts
   */
  detectGroupLayout() {
    try {
      // Check various elements to determine the layout type
      const hasNewDesign = !!document.querySelector('.x9f619.x1n2onr6');
      const hasLegacyDesign = !!document.querySelector(
        '[data-pagelet="GroupFeed"]'
      );
      const hasClassicFeed = !!document.querySelector('[role="feed"]');

      console.log('Group layout detection:', {
        hasNewDesign,
        hasLegacyDesign,
        hasClassicFeed
      });

      // Update selectors based on detected layout
      if (hasNewDesign) {
        // Use modern selectors optimized for new layout
        this.postSelectors = [
          '[role="article"]:not([aria-label*="Comment"]):not([aria-label*="Bình luận"])',
          'div.x1yztbdb:not([aria-label*="Comment"]):has(div[data-ad-comet-preview="message"])',
          'div.x1lliihq:has(div[data-ad-comet-preview="message"])',
          // Additional modern selectors
          'div.x78zum5:not([aria-label*="Comment"])',
          'div.x1lq5wgf:has(div.xdj266r)'
        ];
      } else if (hasLegacyDesign) {
        // Use selectors optimized for legacy design
        this.postSelectors = [
          '[role="article"]:not([aria-label*="Comment"]):not([aria-label*="Bình luận"])',
          'div.sjgh65i0',
          'div.du4w35lb:has(div.f530mmz5)',
          'div.lzcic4wl:has(div.kvgmc6g5)'
        ];
      } else {
        // Fallback selectors that work across most layouts
        this.postSelectors = [
          '[role="article"]:not([aria-label*="Comment"]):not([aria-label*="Bình luận"])',
          'div[data-ad-comet-preview="message"]',
          'div.story_body_container',
          'div.userContentWrapper'
        ];
      }

      // Update getPosts method to use the new selectors
      return this.postSelectors;
    } catch (e) {
      console.error('Error detecting group layout:', e);
      // Return default selectors as fallback
      return [
        '[role="article"]:not([aria-label*="Comment"]):not([aria-label*="Bình luận"])'
      ];
    }
  }
}

// Create global instance
window.facebookScraper = new FacebookScraper();
