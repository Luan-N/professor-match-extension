// Content script: scans web pages for professor names from saved storage and marks them
console.log("Professor Match content.js started");
// DOM marker class added to matched professor name elements
const MARKER_CLASS = "professor-match-marker";

// Whitelist check: Only run on .edu domains or sites the user has approved
async function isAllowedSite() {
  const hostname = window.location.hostname.toLowerCase();
  
  // Always allow .edu
  if (hostname.endsWith(".edu")) return true;
  
  // Check custom whitelist
  const { allowedDomains = [] } = await chrome.storage.local.get("allowedDomains");
  return allowedDomains.some(domain => 
    hostname === domain || hostname.endsWith("." + domain)
  );
}

// Retrieve saved professors from extension storage
async function getSavedProfessors() {
  const result = await chrome.storage.local.get("professors");
  return result.professors || [];
}

// Build one matcher per unique name pattern and keep all professor IDs that
// share that pattern.
function buildProfessorMatchers(professors) {
  const matchersByPattern = new Map();

  professors.forEach((professor, index) => {
    if (!professor.firstName || !professor.lastName) return;

    const firstName = professor.firstName.trim();
    const lastName = professor.lastName.trim();
    const professorKey = String(professor.id || `${firstName} ${lastName}:${index}`);
    const pattern = getNamePattern(firstName, lastName);
    const patternKey = pattern.source;

    if (!matchersByPattern.has(patternKey)) {
      matchersByPattern.set(patternKey, {
        name: `${firstName} ${lastName}`,
        pattern,
        professorsById: new Map()
      });
    }

    matchersByPattern.get(patternKey).professorsById.set(professorKey, professor);
  });

  return [...matchersByPattern.values()];
}

// Check if an element already has a professor marker ancestor (avoid double-processing)
function isAlreadyMarked(node) {
  return Boolean(node.parentElement?.closest(`.${MARKER_CLASS}`));
}

// Mark a single text node containing a professor name
function markTextNode(textNode, professorMatchers) {
  const text = textNode.textContent;

  // Find which professor name(s) appear in this text node
  let matchedName = null;
  let matchedText = null;
  let matchedProfessors = new Map();
  for (const matcher of professorMatchers) {
    const match = matcher.pattern.exec(text);
    if (match) {
      if (!matchedText || match[0].length > matchedText.length) {
        matchedName = matcher.name;
        matchedText = match[0];
        matchedProfessors = new Map(matcher.professorsById);
      } else if (match[0] === matchedText) {
        // Multiple professor patterns can match the same text, such as
        // "F. Butt" for both Fain Butt and Frank Butt.
        for (const [professorId, professor] of matcher.professorsById) {
          matchedProfessors.set(professorId, professor);
        }
      }
    }
  }

  if (!matchedName) return null;

  // Split the text node around the matched name and wrap the match in a span
  const regex = new RegExp(`(${escapeRegex(matchedText)})`, "g");
  const parts = text.split(regex);

  if (parts.length <= 1) return null;

  const fragment = document.createDocumentFragment();
  const matchedProfessorList = [...matchedProfessors.values()];

  for (const part of parts) {
    if (part === matchedText) {
      const matchGroup = document.createElement("span");
      matchGroup.className = "professor-match-group";

      const markerButton = document.createElement("button");
      markerButton.type = "button";
      markerButton.className = MARKER_CLASS;
      markerButton.textContent = part;
      
      // Store only the professor ID on the marker for later use.
      if (matchedProfessorList.length === 1) {
        markerButton.dataset.professorId = matchedProfessorList[0].id || "";
      }
      
      markerButton.title = `Professor: ${matchedText}`;
      markerButton.addEventListener("click", (event) => {
        // Prevent a marker inside an existing link/button from triggering
        // the page's original navigation or click handler as well.
        event.preventDefault();
        event.stopPropagation();
        
        const existingPopover = markerButton._professorPopover?.isConnected
          ? markerButton._professorPopover
          : null;
          
        document.querySelectorAll(".professor-popover").forEach((popover) => {
          if (popover !== existingPopover) popover.remove();
        });
        
        if (existingPopover) {
          existingPopover.remove();
          markerButton._professorPopover = null;
        } else {
          const popover = createProfessorPopover(
            matchedProfessorList,
            (professor) => {
              markerButton.dataset.professorId = professor.id || "";
            }
          );
          document.body.appendChild(popover);
          positionProfessorPopover(popover, markerButton);
          markerButton._professorPopover = popover;
        }
      });
      
      matchGroup.appendChild(markerButton);

      // Display the rating underneath the marker without storing it in the DOM.
      if (matchedProfessorList.length === 1) {
        const matchedProfessor = matchedProfessorList[0];
        const ratingTag = document.createElement("span");
        ratingTag.className = "professor-rating-tag";
        ratingTag.textContent = `★ ${matchedProfessor.avgRating}`;
        matchGroup.appendChild(ratingTag);
      } else if (matchedProfessorList.length > 1) {
        const ratingTag = document.createElement("span");
        ratingTag.className = "professor-rating-tag";
        ratingTag.textContent = "Multiple matches";
        matchGroup.appendChild(ratingTag);
      }

      fragment.appendChild(matchGroup);
    } else {
      fragment.appendChild(document.createTextNode(part));
    }
  }

  textNode.parentNode.replaceChild(fragment, textNode);
  return matchedName;
}

// Escape special regex characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Create one case-sensitive pattern for a professor. It supports forward and
// reverse order, full names and initials, with a bounded middle-text wildcard.
function getNamePattern(firstName, lastName) {
  // Require the period for an initial so a normal word like "This" cannot
  // be treated as the initial "T".
  const firstOrInitial = `(?:${escapeRegex(firstName)}|${escapeRegex(firstName.charAt(0))}\\.)`;
  // Allow any characters between the first/initial and last name, but cap the
  // search distance so one match cannot span an entire paragraph.
  const middleTokens = "[\\s\\S]{0,20}?";
  
  // KEEPING PARTNER'S REGEX FIX HERE
  const forward = `${firstOrInitial}${middleTokens}${escapeRegex(lastName)}`;
  const reverse = `${escapeRegex(lastName)}${middleTokens}${firstOrInitial}`;
  return new RegExp(`(?:${forward}|${reverse})`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));
}

function getProgressWidth(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, (number / max) * 100));
}

// Build the details panel shown after a professor is selected.
function createProfessorDetailsPopover(professor) {
  const popover = document.createElement("div");
  popover.className = "professor-popover";
  popover.setAttribute("role", "dialog");
  const ratingWidth = getProgressWidth(professor.avgRating, 5);
  const difficultyWidth = getProgressWidth(professor.avgDifficulty, 5);
  const rating = professor.avgRating ?? "N/A";
  const difficulty = professor.avgDifficulty ?? "N/A";

  popover.innerHTML = `
    <strong>${escapeHtml(professor.firstName || "")} ${escapeHtml(professor.lastName || "")}</strong>
    <div class="professor-popover-subtitle">${escapeHtml(professor.department || "Department unavailable")}</div>
    <div class="professor-stat-box">
      <div class="professor-stat-row"><span>Rating</span><span>${escapeHtml(rating)}</span></div>
      <div class="professor-progress-track"><div class="professor-progress-bar" style="width: ${ratingWidth}%"></div></div>
    </div>
    <div class="professor-stat-box">
      <div class="professor-stat-row"><span>Difficulty</span><span>${escapeHtml(difficulty)}</span></div>
      <div class="professor-progress-track"><div class="professor-progress-bar" style="width: ${difficultyWidth}%"></div></div>
    </div>
    <div class="professor-detail-row"><span>Ratings</span><strong>${escapeHtml(professor.numRatings ?? "N/A")}</strong></div>
    <div class="professor-detail-row"><span>Would take again</span><strong>${escapeHtml(professor.wouldTakeAgainPercent ?? "N/A")}%</strong></div>
  `;

  if (professor.legacyId) {
    const profileLink = document.createElement("a");
    profileLink.className = "professor-profile-link";
    profileLink.href = `https://www.ratemyprofessors.com/professor/${encodeURIComponent(professor.legacyId)}`;
    profileLink.target = "_blank";
    profileLink.rel = "noopener noreferrer";
    profileLink.textContent = "View Full Profile";
    popover.appendChild(profileLink);
  }

  return popover;
}

// Show a chooser when the same visible name can refer to multiple professors.
function createProfessorPopover(professors, onSelect) {
  if (professors.length === 1) {
    onSelect?.(professors[0]);
    return createProfessorDetailsPopover(professors[0]);
  }

  const popover = document.createElement("div");
  popover.className = "professor-popover";
  popover.setAttribute("role", "dialog");

  const heading = document.createElement("strong");
  heading.textContent = "Select professor";
  popover.appendChild(heading);

  const subtitle = document.createElement("div");
  subtitle.className = "professor-popover-subtitle";
  subtitle.textContent = "Multiple professors match this name.";
  popover.appendChild(subtitle);

  for (const professor of professors) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "professor-choice";
    choice.textContent = [
      `${professor.firstName || ""} ${professor.lastName || ""}`.trim(),
      professor.department || "Department unavailable"
    ].join(" - ");
    choice.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect?.(professor);
      popover.replaceWith(createProfessorDetailsPopover(professor));
    });
    popover.appendChild(choice);
  }

  return popover;
}

// Position the popover inside the viewport, preferring above the marker and
// falling below it when there is not enough room above.
function positionProfessorPopover(popover, marker) {
  const padding = 8;
  const gap = 8;
  const markerRect = marker.getBoundingClientRect();

  // Measure after insertion, but keep it hidden while calculating its bounds.
  popover.style.visibility = "hidden";
  const popoverRect = popover.getBoundingClientRect();
  const width = popoverRect.width;
  const height = popoverRect.height;

  let left = markerRect.left;
  left = Math.min(left, window.innerWidth - width - padding);
  left = Math.max(left, padding);

  let top = markerRect.top - height - gap;
  if (top < padding) {
    top = markerRect.bottom + gap;
  }
  top = Math.min(top, window.innerHeight - height - padding);
  top = Math.max(top, padding);

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = "visible";
}

// Walk the DOM tree and mark professor names
function markProfessorsOnPage(professorMatchers) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Skip empty text, script/style tags, and already-marked elements
        if (!node.textContent || !node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.closest("script, style, .professor-popover")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (isAlreadyMarked(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  // Collect nodes before replacing any of them. Mutating the DOM while a
  // TreeWalker is traversing it can detach its current node and stop walking.
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  const matchedNames = [];
  for (const textNode of textNodes) {
    const matchedName = markTextNode(textNode, professorMatchers);
    if (matchedName) {
      matchedNames.push(matchedName);
    }
  }

  return matchedNames;
}

// Main entry point: scan page for professors
async function scanPageForProfessors() {
  if (isScanning) return;
  isScanning = true;

  try {
    const professors = await getSavedProfessors();
    if (!professors || professors.length === 0) return; // No professors saved

    // First filter the full professor list using visible body text.
    const professorMatchers = buildProfessorMatchers(professors);
    const bodyText = document.body.textContent || "";
    const comparableBodyText = bodyText.trim();
    const potentialMatches = professorMatchers.filter((matcher) =>
      matcher.pattern.test(comparableBodyText)
    );

    console.log("Professor Match potential matches:", potentialMatches.map(({ name }) => name));
    if (potentialMatches.length === 0) return; // No potential matches on this page

    // Walk the DOM only with the reduced list and compare both name formats again.
    const matches = markProfessorsOnPage(potentialMatches);
    console.log("Professor Match actual matches:", matches);

    // Discard mutation records created by inserting our own markers so the
    // observer does not schedule another scan for each marker we added.
    pageObserver.takeRecords();
  } catch (error) {
    console.error("Professor Match content script error:", error);
  } finally {
    isScanning = false;
  }
}

let isScanning = false;
let scanTimer = null;

// Close any open professor popover when the user clicks elsewhere on the page.
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (
    event.target.closest(`.${MARKER_CLASS}`) ||
    event.target.closest(".professor-popover")
  ) {
    return;
  }

  document.querySelectorAll(".professor-popover").forEach((popover) => {
    popover.remove();
  });
});

// Debounce scans so several DOM updates from one page render cause only one scan.
function scheduleScan() {
  if (scanTimer !== null) window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    scanPageForProfessors();
  }, 250);
}

// Pages such as course schedules often render their content after document_idle.
// Observe later DOM changes so dynamically inserted professor names are scanned too.
const pageObserver = new MutationObserver((mutations) => {
  if (isScanning) return;
  
  const pageChanged = mutations.some((mutation) => mutation.type === "childList" || mutation.type === "characterData");
  if (pageChanged) scheduleScan();
});

// Start extension only if the current site is .edu or whitelisted
async function startExtension() {
  const allowed = await isAllowedSite();
  if (!allowed) {
    return; // Exit immediately if site is not allowed
  }

  console.log("Professor Match started on allowed site:", window.location.hostname);

  pageObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });

  // Scan the current DOM immediately
  scanPageForProfessors();
}

// Call the start function
startExtension();