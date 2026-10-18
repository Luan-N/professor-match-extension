// DOM elements for the onboarding interface
const schoolInput = document.getElementById("schoolName");
const resultsList = document.getElementById("schoolResults");
const searchStatus = document.getElementById("searchStatus");
const continueButton = document.getElementById("continueButton");

// State variables for search functionality
let selectedSchool = null;
let searchTimer = null;
let searchRequestId = 0;

/**
 * Clears the search timer to prevent duplicate searches
 */
function clearSearchTimer() {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }
}

/**
 * Renders school search results as clickable buttons in the results list
 * @param {Array} schools - Array of school objects from the GraphQL response
 */
function renderResults(schools) {
  // Clear existing results
  resultsList.replaceChildren();

  // Create a button for each school
  for (const school of schools) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "school-result";
    // Display school name with city and state
    button.textContent = `${school.name} (${school.city}, ${school.state})`;
    button.addEventListener("click", () => {
      // Update state when a school is selected
      selectedSchool = school;
      schoolInput.value = school.name;
      continueButton.disabled = false;
      // Clear results and update status
      resultsList.replaceChildren();
      searchStatus.textContent = "School selected.";
      clearSearchTimer();
    });
    item.append(button);
    resultsList.append(item);
  }
}

/**
 * Performs a GraphQL search for schools using the RateMyProfessors API
 * This function is reusable and can be called from anywhere in the extension
 * @param {string} searchText - The text to search for schools
 * @returns {Promise<Array>} - Array of school objects matching the search
 */
async function fetchSchoolsFromGraphQL(searchText) {
  // Return empty array for empty search text
  if (!searchText || searchText.trim() === "") {
    return [];
  }

  try {
    const response = await fetch("https://www.ratemyprofessors.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        operationName: "NewSearchSchoolsQuery",
        query: `
          query NewSearchSchoolsQuery(
            $query: SchoolSearchQuery
            $includeCompare: Boolean!
          ) {
            newSearch {
              schools(query: $query) {
                edges {
                  cursor
                  node {
                    id
                    legacyId
                    name
                    city
                    state
                    departments {
                      id
                      name
                    }
                    name @include(if: $includeCompare)
                    city @include(if: $includeCompare)
                    state @include(if: $includeCompare)
                    country @include(if: $includeCompare)
                    numRatings @include(if: $includeCompare)
                    avgRatingRounded @include(if: $includeCompare)
                    legacyId @include(if: $includeCompare)
                    summary @include(if: $includeCompare) {
                      campusCondition
                      campusLocation
                      careerOpportunities
                      clubAndEventActivities
                      foodQuality
                      internetSpeed
                      libraryCondition
                      schoolReputation
                      schoolSafety
                      schoolSatisfaction
                      socialActivities
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        `,
        variables: {
          query: { text: searchText.trim() },
          includeCompare: false
        }
      })
    });

    if (!response.ok) {
      throw new Error(`School search failed (${response.status}).`);
    }

    const result = await response.json();
    if (result.errors?.length) {
      throw new Error(result.errors[0].message || "School search failed.");
    }

    // Extract school nodes from GraphQL response structure
    return result.data?.newSearch?.schools?.edges
      ?.map((edge) => edge.node)
      .filter((school) => school?.id && school.name) || [];
  } catch (error) {
    // Re-throw error to be handled by caller
    throw error;
  }
}

/**
 * GraphQL query for fetching all teachers/professors for a given school
 * Uses pagination via $first (page size) and $after (cursor)
 */
const ALL_TEACHERS_QUERY = `
  query AllSchoolTeachers(
    $query: TeacherSearchQuery!
    $first: Int
    $after: String
  ) {
    newSearch {
      teachers(
        query: $query
        first: $first
        after: $after
      ) {
        edges {
          node {
            id
            legacyId
            firstName
            lastName
            department
            avgRating
            avgDifficulty
            numRatings
            wouldTakeAgainPercent
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/**
 * Fetches all professors for a given school by paginating through the RateMyProfessors GraphQL API.
 * Continues fetching pages until there are no more results (hasNextPage is false).
 * @param {string} schoolId - The RateMyProfessors school ID to fetch professors for
 * @returns {Promise<Array>} Array of professor node objects containing id, name, ratings, etc.
 */
async function fetchAllProfessors(schoolId) {
  const allProfessors = [];
  let after = null;

  while (true) {
    const response = await fetch("https://www.ratemyprofessors.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        operationName: "AllSchoolTeachers",
        query: ALL_TEACHERS_QUERY,
        variables: {
          query: {
            text: "",
            schoolID: schoolId
          },
          first: 1000,
          after
        }
      })
    });

    if (!response.ok) throw new Error(`Failed to fetch professors (status ${response.status}).`);

    const result = await response.json();

    if (result.errors?.length) throw new Error(result.errors[0].message || "Failed to fetch professors.");

    const teachers = result.data?.newSearch?.teachers;

    if (!teachers) throw new Error("Unexpected response structure when fetching professors.");

    allProfessors.push(
      ...teachers.edges.map((edge) => edge.node)
    );

    console.log(`Loaded ${allProfessors.length} professors`);

    if (!teachers.pageInfo.hasNextPage) {
      break;
    }

    const nextCursor = teachers.pageInfo.endCursor;

    if (!nextCursor || nextCursor === after) {
      throw new Error("Pagination cursor did not advance.");
    }

    after = nextCursor;
  }

  return allProfessors;
}

/**
 * Handles the school search functionality with debouncing
 * This function manages the search state and UI updates
 */
async function searchSchools() {
  const text = schoolInput.value.trim();
  selectedSchool = null;
  continueButton.disabled = true;

  if (!text) {
    clearSearchTimer();
    resultsList.replaceChildren();
    searchStatus.textContent = "";
    return;
  }

  searchStatus.textContent = "Searching...";

  try {
    // Use the reusable GraphQL fetch function
    const schools = await fetchSchoolsFromGraphQL(text);

    // Check if the input hasn't changed during the request (race condition prevention)
    if (schoolInput.value.trim() !== text) {
      return;
    }

    // Render results and update status
    renderResults(schools);
    searchStatus.textContent = schools.length
      ? "Select your school from the results."
      : "No schools found.";
  } catch (error) {
    resultsList.replaceChildren();
    searchStatus.textContent = error.message;
  }
}

// Event listener for school input with debouncing (1 second delay)
schoolInput.addEventListener("input", () => {
  clearSearchTimer();
  const text = schoolInput.value.trim();
  selectedSchool = null;
  continueButton.disabled = true;

  if (!text) {
    resultsList.replaceChildren();
    searchStatus.textContent = "";
    return;
  }

  searchStatus.textContent = "Waiting to search...";
  const requestId = ++searchRequestId;
  // Set a timer to perform the search after 1 second of inactivity and its not canceled by another input event
  searchTimer = window.setTimeout(() => {
    if (requestId === searchRequestId) {
      searchSchools();
    }
  }, 1000);
});

// Event listener for continue button
continueButton.addEventListener("click", async () => {
  if (!selectedSchool) {
    searchStatus.textContent = "Please select a school from the results.";
    return;
  }

  await chrome.storage.local.set({
    schoolId: selectedSchool.id,
    schoolLegacyId: selectedSchool.legacyId,
    schoolName: selectedSchool.name,
    schoolCity: selectedSchool.city,
    schoolState: selectedSchool.state,
  });

  // Load and store all professors for the selected school directly (no background messaging)
  try {
    const allProfessors = await fetchAllProfessors(selectedSchool.id);

    await chrome.storage.local.set({
      professors: allProfessors,
      professorsLoadedAt: Date.now(),
      totalProfessors: allProfessors.length
    });

    console.log("Professors loaded and saved:", allProfessors.length);
    searchStatus.textContent = `Setup complete! Loaded ${allProfessors.length} professors.`;
  } catch (error) {
    console.error("Failed to load professors:", error.message);
    searchStatus.textContent = `Setup complete! (Professor loading failed: ${error.message})`;
  }

  clearSearchTimer();
  document.querySelector("main").replaceChildren(
    Object.assign(document.createElement("h1"), { textContent: "Setup complete!" }),
    Object.assign(document.createElement("p"), {
      textContent: `Your school is set to ${selectedSchool.name}. You can change this later in the extension popup.`
    })
  );
});