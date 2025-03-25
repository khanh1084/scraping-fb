/**
 * Popup script for the extension
 */
document.addEventListener('DOMContentLoaded', function () {
  // UI Elements
  const notFacebookGroup = document.getElementById('not-facebook-group');
  const mainContent = document.getElementById('main-content');
  const groupDetails = document.getElementById('group-details');
  const postCount = document.getElementById('post-count');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const downloadBtn = document.getElementById('download-btn');
  const progress = document.getElementById('progress');
  const postsScraped = document.getElementById('posts-scraped');
  const results = document.getElementById('results');
  const resultsSummary = document.getElementById('results-summary');

  let currentGroupInfo = null;
  let lastScrapedData = null;
  let isScrapingActive = false;
  let progressInterval = null;

  // Check if we're on a Facebook group page
  checkCurrentTab();

  // Load any previously scraped data
  loadLastScrapedData();

  // Button event listeners
  startBtn.addEventListener('click', startScraping);
  stopBtn.addEventListener('click', stopScraping);
  downloadBtn.addEventListener('click', downloadData);

  // Check for active scraping session
  loadScrapingState();

  /**
   * Check if current tab is a Facebook group
   */
  function checkCurrentTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];

      if (
        currentTab &&
        currentTab.url &&
        currentTab.url.match(/facebook\.com\/groups\/[^\/]+\/?/)
      ) {
        // We're on a Facebook group page
        notFacebookGroup.classList.add('hidden');
        mainContent.classList.remove('hidden');

        // Get group info
        chrome.tabs.sendMessage(
          currentTab.id,
          {
            action: 'extractGroupInfo'
          },
          function (response) {
            if (response && response.success && response.groupInfo) {
              currentGroupInfo = response.groupInfo;
              displayGroupInfo(currentGroupInfo);
            } else {
              groupDetails.textContent =
                'Could not extract group information. Please refresh the page.';
            }
          }
        );
      } else {
        // Not on a Facebook group page
        notFacebookGroup.classList.remove('hidden');
        mainContent.classList.add('hidden');
      }
    });
  }

  /**
   * Display group information
   */
  function displayGroupInfo(info) {
    if (!info) return;

    groupDetails.innerHTML = `
      <p><strong>Name:</strong> ${info.name}</p>
      <p><strong>Members:</strong> ${info.membersCount}</p>
      <p><strong>ID:</strong> ${info.id}</p>
    `;
  }

  /**
   * Load last scraped data from storage
   */
  function loadLastScrapedData() {
    chrome.storage.local.get('lastScrapedData', function (result) {
      if (result.lastScrapedData) {
        lastScrapedData = result.lastScrapedData;
        downloadBtn.disabled = false;

        // Show results summary
        results.classList.remove('hidden');
        resultsSummary.innerHTML = `
          <p>Last scraped: ${new Date(
            lastScrapedData.group.scrapedAt
          ).toLocaleString()}</p>
          <p>Group: ${lastScrapedData.group.name}</p>
          <p>Posts collected: ${lastScrapedData.posts.length}</p>
          <p>Images found: ${countImages(lastScrapedData.posts)}</p>
        `;
      }
    });
  }

  /**
   * Count total images in posts
   */
  function countImages(posts) {
    return posts.reduce(
      (total, post) => total + (post.images ? post.images.length : 0),
      0
    );
  }

  /**
   * Start scraping posts
   */
  function startScraping() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const count = parseInt(postCount.value);

      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: 'startScraping',
          count: count
        },
        function (response) {
          if (response && response.success) {
            // Update UI to show scraping is active
            isScrapingActive = true;
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            progress.classList.remove('hidden');
            results.classList.add('hidden');

            // Start a progress simulation (since we don't get real-time updates)
            simulateProgress(count);
          }
        }
      );
    });
  }

  /**
   * Stop scraping posts
   */
  function stopScraping() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          action: 'stopScraping'
        },
        function (response) {
          // Update UI to show scraping is stopped
          isScrapingActive = false;
          startBtn.classList.remove('hidden');
          stopBtn.classList.add('hidden');

          // Clear the progress simulation
          clearInterval(progressInterval);
        }
      );
    });
  }

  /**
   * Download scraped data
   */
  function downloadData(data) {
    if (!data) return;

    // Create appropriate filename
    let filename;
    if (data.group) {
      filename = `facebook_group_${data.group.id || 'data'}_${formatDate(
        new Date()
      )}`;
      // Add indicator if it's partial data
      if (data.partialData) {
        filename += '_partial';
      }
      filename += '.json';
    } else {
      filename = `facebook_data_${formatDate(new Date())}.json`;
    }

    // Show notification for partial data
    if (data.partialData) {
      const notification = document.createElement('div');
      notification.className = 'notification';
      notification.textContent =
        'Downloading partial data (scraping still in progress)';
      document.body.appendChild(notification);

      // Auto-remove after 3 seconds
      setTimeout(() => {
        notification.remove();
      }, 3000);
    }

    chrome.runtime.sendMessage({
      action: 'downloadData',
      data: data,
      filename: filename
    });
  }

  /**
   * Format date for filename
   */
  function formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Show real progress based on scraper updates
   */
  function simulateProgress(total) {
    const progressBar = document.querySelector('.progress-value');

    // Initialize progress display
    progressBar.style.width = '0%';
    postsScraped.textContent = '0';

    // Listen for progress updates and completion
    chrome.runtime.onMessage.addListener(function listener(message) {
      if (message.action === 'scrapingProgress') {
        // Update progress based on actual scraped posts
        const current = message.data.current;
        const percentage = Math.min((current / total) * 100, 100);

        progressBar.style.width = `${percentage}%`;
        postsScraped.textContent = current;
      } else if (message.action === 'scrapingComplete') {
        // Update UI to show scraping is complete
        isScrapingActive = false;
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');

        // Show complete progress
        progressBar.style.width = '100%';
        postsScraped.textContent = message.data.posts.length;

        // Clear the interval (if any was left from the old implementation)
        if (progressInterval) {
          clearInterval(progressInterval);
        }

        // Update results
        lastScrapedData = message.data;
        loadLastScrapedData();

        // Enable download button
        downloadBtn.disabled = false;

        // Remove this listener
        chrome.runtime.onMessage.removeListener(listener);
      }
    });
  }

  /**
   * Load scraping state when popup opens
   */
  function loadScrapingState() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'getScrapingState' },
          function (response) {
            // Check if scraping is currently active
            if (response && response.isCollecting) {
              // Update UI to show scraping is active
              isScrapingActive = true;
              startBtn.classList.add('hidden');
              stopBtn.classList.remove('hidden');
              progress.classList.remove('hidden');
              results.classList.add('hidden');

              // Update progress based on current state
              const progressBar = document.querySelector('.progress-value');
              const current = response.currentCount;
              const total = response.totalCount;

              const percentage = Math.min((current / total) * 100, 100);
              progressBar.style.width = `${percentage}%`;
              postsScraped.textContent = current;

              // Set the post count input to match current scraping target
              postCount.value = total;
            }
          }
        );
      }
    });
  }

  // Add to your download button click handler
  downloadBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'requestData' },
          function (response) {
            if (chrome.runtime.lastError || !response || !response.data) {
              // Try to get data from background
              chrome.runtime.sendMessage(
                { action: 'getLastResult' },
                function (backgroundResponse) {
                  if (
                    chrome.runtime.lastError ||
                    !backgroundResponse ||
                    !backgroundResponse.data
                  ) {
                    // Final fallback - inject script to get from localStorage
                    chrome.scripting.executeScript(
                      {
                        target: { tabId: tabs[0].id },
                        function: retrieveFromLocalStorage
                      },
                      (results) => {
                        if (results && results[0] && results[0].result) {
                          downloadData(results[0].result);
                        } else {
                          showError(
                            'Could not retrieve scraped data. Please try scraping again.'
                          );
                        }
                      }
                    );
                  } else {
                    downloadData(backgroundResponse.data);
                  }
                }
              );
            } else {
              downloadData(response.data);
            }
          }
        );
      }
    });
  });

  // Function to be injected into the page
  function retrieveFromLocalStorage() {
    // First try to get completed data
    let storedData = localStorage.getItem('fb-scraper-last-result');

    // If no completed data, get in-progress data
    if (!storedData) {
      storedData = localStorage.getItem('fb-scraper-progress-data');
    }

    if (storedData) {
      try {
        const data = JSON.parse(storedData);
        // Add warning if data is incomplete
        if (data && !data.isComplete) {
          data.partialData = true;
        }
        return data;
      } catch (e) {
        return null;
      }
    }
    return null;
  }
});
