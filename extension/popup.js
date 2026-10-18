// DOM elements for the popup interface
const currentSchoolInfo = document.getElementById("current-school-info");
const changeSchoolButton = document.getElementById("changeSchoolButton");

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

// Initialize: display current school when the popup loads
document.addEventListener("DOMContentLoaded", updateCurrentSchoolDisplay);