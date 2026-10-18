// Background service worker - school search functionality moved to onboarding.js

// Open onboarding page when extension is first installed
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html")
    });
  }
});