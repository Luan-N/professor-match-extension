// DOM elements for the popup interface
const currentSchoolInfo = document.getElementById("current-school-info");
const changeSchoolButton = document.getElementById("changeSchoolButton");

// Whitelist vars
const siteStatus = document.getElementById("site-status");
const allowCurrentSiteButton = document.getElementById("allowCurrentSiteButton");
const manualDomainInput = document.getElementById("manualDomainInput");
const addDomainButton = document.getElementById("addDomainButton");
const domainList = document.getElementById("domainList");
let currentHostname = "";


/**
 * Updates the current school display based on stored data
 */
async function updateCurrentSchoolDisplay() {
  const { schoolId, schoolName, schoolCity, schoolState, totalProfessors } = await chrome.storage.local.get([
    "schoolId", "schoolName", "schoolCity", "schoolState", "totalProfessors"
  ]);

  if (schoolId && schoolName) {
    let professorInfo = totalProfessors ? ` (${totalProfessors} professors loaded)` : "";
    currentSchoolInfo.textContent = `Current school: ${schoolName} (${schoolCity}, ${schoolState})${professorInfo}`;
  } else {
    currentSchoolInfo.textContent = "No school selected";
  }
}

// Event listener for change school button
changeSchoolButton.addEventListener("click", async () => {
  // Open the onboarding page in a new tab
  const onboardingUrl = chrome.runtime.getURL("onboarding.html");
  await chrome.tabs.create({ url: onboardingUrl });
  // Close the current popup
  window.close();
});

// Whitelist
async function renderDomains() {
  const { allowedDomains = [] } = await chrome.storage.local.get("allowedDomains");
  domainList.innerHTML = "";
  
  if (allowedDomains.length === 0) {
    domainList.innerHTML = "<li>No custom sites added.</li>";
    return;
  }

  allowedDomains.forEach(domain => {
    const li = document.createElement("li");
    // Use flexbox to push the text to the left and the X button to the right
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";
    li.style.marginBottom = "5px";

    // Create the domain text
    const textSpan = document.createElement("span");
    textSpan.textContent = domain;
    
    // Create the "X" delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "X";
    
    // Style the button to look like a small red badge
    deleteBtn.style.padding = "2px 6px";
    deleteBtn.style.backgroundColor = "#ff4d4d";
    deleteBtn.style.color = "white";
    deleteBtn.style.border = "none";
    deleteBtn.style.borderRadius = "4px";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.style.fontSize = "10px";
    deleteBtn.title = "Remove this site";

    // Add the click to delete the domain
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation(); // Prevent accidental clicks
      
      // Get current list
      const { allowedDomains: currentList = [] } = await chrome.storage.local.get("allowedDomains");
      
      // Filter out the one we want to delete
      const updatedList = currentList.filter(d => d !== domain);
      
      // Save the new list to storage
      await chrome.storage.local.set({ allowedDomains: updatedList });
      
      // Re-render the list
      renderDomains();
      
      // Check the current tab so the green button resets if they just deleted the site they are on!
      checkCurrentTab(); 
    });

    // Append span and button to list item
    li.appendChild(textSpan);
    li.appendChild(deleteBtn);
    domainList.appendChild(li);
  });
}

async function checkCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      siteStatus.textContent = "Cannot enable on this page type.";
      allowCurrentSiteButton.disabled = true;
      return;
    }

    currentHostname = url.hostname.toLowerCase();
    siteStatus.textContent = `Current site: ${currentHostname}`;

    const { allowedDomains = [] } = await chrome.storage.local.get("allowedDomains");
    const isEdu = currentHostname.endsWith(".edu");
    const isWhitelisted = allowedDomains.includes(currentHostname);

    if (isEdu || isWhitelisted) {
      allowCurrentSiteButton.textContent = "Already Enabled";
      allowCurrentSiteButton.disabled = true;
      allowCurrentSiteButton.style.backgroundColor = "#888";
    }
  } catch (e) {
    console.error("Error parsing URL", e);
  }
}

allowCurrentSiteButton.addEventListener("click", async () => {
  if (!currentHostname) return;

  const { allowedDomains = [] } = await chrome.storage.local.get("allowedDomains");
  if (!allowedDomains.includes(currentHostname)) {
    allowedDomains.push(currentHostname);
    await chrome.storage.local.set({ allowedDomains });
    
    allowCurrentSiteButton.textContent = "Already Enabled";
    allowCurrentSiteButton.disabled = true;
    allowCurrentSiteButton.style.backgroundColor = "#888";
    renderDomains();
  }
});

addDomainButton.addEventListener("click", async () => {
  let domain = manualDomainInput.value.trim().toLowerCase();
  if (!domain) return;

  try {
    if (domain.includes("://")) domain = new URL(domain).hostname;
    else if (domain.includes("/")) domain = domain.split("/")[0];
  } catch (e) { return; }

  const { allowedDomains = [] } = await chrome.storage.local.get("allowedDomains");
  if (!allowedDomains.includes(domain)) {
    allowedDomains.push(domain);
    await chrome.storage.local.set({ allowedDomains });
    manualDomainInput.value = "";
    renderDomains();
  }
});

// Initialize: display current school when the popup loads
//document.addEventListener("DOMContentLoaded", updateCurrentSchoolDisplay);

// Adds the two new functions so they run when the popup opens
document.addEventListener("DOMContentLoaded", () => {
  updateCurrentSchoolDisplay();
  checkCurrentTab();
  renderDomains();
});