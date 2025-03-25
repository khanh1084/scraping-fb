/**
 * Background script for handling data persistence and downloads
 */

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.action === 'scrapingComplete') {
    // Save the scraped data to storage
    chrome.storage.local.set(
      {
        lastScrapedData: message.data
      },
      function () {
        console.log('Data saved to storage');

        // Show notification
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

        // Clear badge after 5 seconds
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '' });
        }, 5000);
      }
    );
  } else if (message.action === 'downloadData') {
    downloadData(message.data, message.filename);
  } else if (message.action === 'contentScriptLoaded') {
    console.log('Content script loaded on page:', sender.tab?.url);
  }
});

/**
 * Download data as JSON file
 */
function downloadData(data, filename = 'facebook_group_data.json') {
  try {
    // Convert the data to a JSON string
    const jsonString = JSON.stringify(data, null, 2);

    // Create a data URI
    const dataUri =
      'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);

    // Use chrome.downloads API with the data URI
    chrome.downloads.download(
      {
        url: dataUri,
        filename: filename,
        saveAs: true
      },
      (downloadId) => {
        console.log('Download started with ID:', downloadId);
      }
    );
  } catch (error) {
    console.error('Error in downloadData:', error);
    // Fallback for very large data that might exceed URI length limits
    try {
      // Break into chunks if needed
      const jsonString = JSON.stringify(data);
      if (jsonString.length > 1500000) {
        // ~1.5MB limit for data URIs in some browsers
        // Use a different approach for large data
        downloadLargeData(data, filename);
      } else {
        throw new Error('Data too large for standard download');
      }
    } catch (fallbackError) {
      console.error('Fallback download method failed:', fallbackError);
    }
  }
}

/**
 * Handle large data downloads by breaking into smaller parts
 */
function downloadLargeData(data, filename) {
  // Notify user about large download
  chrome.action.setBadgeText({ text: 'BIG' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF9800' });

  // For large files, we'll create multiple files with a smaller subset of posts
  const POSTS_PER_FILE = 100;
  const posts = data.posts || [];
  const totalFiles = Math.ceil(posts.length / POSTS_PER_FILE);

  for (let i = 0; i < totalFiles; i++) {
    const start = i * POSTS_PER_FILE;
    const end = Math.min((i + 1) * POSTS_PER_FILE, posts.length);

    const partData = {
      ...data,
      posts: posts.slice(start, end),
      part: {
        index: i + 1,
        total: totalFiles,
        range: `${start + 1}-${end} of ${posts.length}`
      }
    };

    const partFilename = filename.replace(
      '.json',
      `_part${i + 1}of${totalFiles}.json`
    );
    const jsonString = JSON.stringify(partData, null, 2);
    const dataUri =
      'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);

    // Queue download with delay to prevent browser from blocking multiple downloads
    setTimeout(() => {
      chrome.downloads.download({
        url: dataUri,
        filename: partFilename,
        saveAs: i === 0 // Only ask for save location for the first file
      });
    }, i * 1000); // 1 second delay between files
  }

  // Clear badge after all downloads are queued
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, totalFiles * 1000 + 2000);
}
