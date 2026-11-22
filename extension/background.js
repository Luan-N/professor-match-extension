// Background service worker

// Open onboarding on first install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html")
    });
  }
});

// The GraphQL query for all professors
const ALL_TEACHERS_QUERY = `
  query AllSchoolTeachers(
    $query: TeacherSearchQuery!
    $first: Int
    $after: String
  ) {
    newSearch {
      teachers(query: $query, first: $first, after: $after) {
        edges {
          node {
            id legacyId firstName lastName department 
            avgRating avgDifficulty numRatings wouldTakeAgainPercent
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

async function fetchAllProfessors(schoolId) {
  const allProfessors = [];
  let after = null;

  while (true) {
    const response = await fetch("https://www.ratemyprofessors.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "AllSchoolTeachers",
        query: ALL_TEACHERS_QUERY,
        variables: {
          query: { text: "", schoolID: schoolId },
          first: 1000,
          after
        }
      })
    });

    if (!response.ok) throw new Error(`Status ${response.status}`);

    const result = await response.json();
    const teachers = result.data?.newSearch?.teachers;
    if (!teachers) throw new Error("Unexpected response");

    allProfessors.push(...teachers.edges.map((edge) => edge.node));

    if (!teachers.pageInfo.hasNextPage) break;
    after = teachers.pageInfo.endCursor;
  }
  return allProfessors;
}

// The startup check (TTL)
chrome.runtime.onStartup.addListener(async () => {
  console.log("Chrome started. Checking professor data freshness...");

  const { schoolId, professorsLoadedAt } = await chrome.storage.local.get([
    "schoolId", "professorsLoadedAt"
  ]);

  if (!schoolId) return;

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const isStale = !professorsLoadedAt || (Date.now() - professorsLoadedAt > THIRTY_DAYS);

  if (isStale) {
    console.log("Data is older than 30 days. Fetching new list in background...");
    try {
      const allProfessors = await fetchAllProfessors(schoolId);
      await chrome.storage.local.set({
        professors: allProfessors,
        professorsLoadedAt: Date.now(),
        totalProfessors: allProfessors.length
      });
      console.log(`Successfully refreshed ${allProfessors.length} professors on startup!`);
    } catch (error) {
      console.error("Failed to auto-refresh professors:", error);
    }
  }
});

// --- AI AGENT MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FETCH_RMP_REVIEWS") {
    fetchProfessorReviewsFromBackground(request.professorId)
      .then((reviews) => sendResponse({ success: true, reviews }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    
    return true; // Keep message channel open for async response
  }
});

const TEACHER_REVIEWS_QUERY = `
  query TeacherRatingsQuery($id: ID!, $first: Int!) {
    node(id: $id) {
      ... on Teacher {
        ratings(first: $first) {
          edges {
            node {
              comment
              class
            }
          }
        }
      }
    }
  }
`;

async function fetchProfessorReviewsFromBackground(professorId) {
  const response = await fetch("https://www.ratemyprofessors.com/graphql", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": "Basic dGVzdDp0ZXN0" // Required by RMP to prevent blocking
    },
    body: JSON.stringify({
      operationName: "TeacherRatingsQuery",
      query: TEACHER_REVIEWS_QUERY,
      variables: { id: professorId, first: 20 }
    })
  });

  if (!response.ok) {
    throw new Error(`RMP returned status ${response.status}`);
  }

  const result = await response.json();
  const reviews = result.data?.node?.ratings?.edges || [];
  const comments = reviews
    .map((edge) => edge.node.comment)
    .filter((comment) => comment && comment.trim() !== "");

  return comments.length > 0 ? comments : ["No written reviews available for this professor."];
}