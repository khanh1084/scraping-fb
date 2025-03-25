/**
 * Content script that runs on Facebook group pages
 */

// Listen for commands from popup
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  console.log('Content script received message:', message);

  if (message.action === 'extractGroupInfo') {
    const groupInfo = window.facebookScraper.extractGroupInfo();
    sendResponse({ success: true, groupInfo: groupInfo });
  } else if (message.action === 'startScraping') {
    const count = message.count || 50;

    // Start async operation and immediately respond
    sendResponse({ success: true, status: 'started' });

    // Start the actual scraping
    window.facebookScraper.startCollecting(count).then((result) => {
      if (result) {
        // Send results to background script when done
        chrome.runtime.sendMessage({
          action: 'scrapingComplete',
          data: result
        });
      }
    });

    // Must return true for async sendResponse
    return true;
  } else if (message.action === 'stopScraping') {
    window.facebookScraper.stopCollecting();
    sendResponse({ success: true, status: 'stopped' });
  } else if (message.action === 'getScrapingState') {
    if (window.facebookScraper) {
      sendResponse({
        isCollecting: window.facebookScraper.isCollecting,
        isPaused: window.facebookScraper.isPaused,
        currentCount: window.facebookScraper.scrapedPosts.length,
        totalCount: window.facebookScraper.postsToCollect
      });
    } else {
      sendResponse({ isCollecting: false });
    }
    return true; // Keep the message channel open for async response
  } else if (message.action === 'requestData') {
    // Try to get either completed or in-progress data
    try {
      // First try to get completed data
      let data = localStorage.getItem('fb-scraper-last-result');

      // If no completed data, get in-progress data
      if (!data) {
        data = localStorage.getItem('fb-scraper-progress-data');
      }

      if (data) {
        sendResponse({
          success: true,
          data: JSON.parse(data)
        });
      } else {
        sendResponse({
          success: false,
          message: 'No scraped data available'
        });
      }
    } catch (e) {
      sendResponse({
        success: false,
        message: e.message
      });
    }
    return true;
  }
});

// Notify that the content script is loaded
console.log('Facebook Group Scraper content script loaded');
chrome.runtime.sendMessage({ action: 'contentScriptLoaded' });
