const NATIVE_HOST = "com.kindlebeam";

let articleData = null;
let currentTabId = null;
let currentUrl = null;

// DOM elements
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const errorMessageEl = document.getElementById("error-message");
const successEl = document.getElementById("success");
const contentEl = document.getElementById("content");
const titleInput = document.getElementById("title-input");
const previewEl = document.getElementById("preview");
const beamBtn = document.getElementById("beam-btn");
const retryBtn = document.getElementById("retry-btn");
const backLink = document.getElementById("back-link");

function showState(state) {
  loadingEl.classList.remove("active");
  errorEl.classList.remove("active");
  successEl.classList.remove("active");
  contentEl.classList.remove("active");

  if (state === "loading") loadingEl.classList.add("active");
  else if (state === "error") errorEl.classList.add("active");
  else if (state === "success") successEl.classList.add("active");
  else if (state === "content") contentEl.classList.add("active");
}

function showError(message) {
  errorMessageEl.textContent = message;
  showState("error");
}

async function parseArticle() {
  showState("loading");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error("No active tab found");
    }

    currentTabId = tab.id;
    currentUrl = tab.url;

    // Check if we can inject into this page
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("brave://") || tab.url.startsWith("about:")) {
      throw new Error("Cannot parse this page type");
    }

    // First inject Readability.js into the MAIN world
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/Readability.js"],
      world: "MAIN"
    });

    // Then run the parser in the same MAIN world
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: parseWithReadability,
      world: "MAIN"
    });

    if (!results || !results[0]) {
      throw new Error("Failed to execute script");
    }

    const result = results[0].result;
    if (!result) {
      throw new Error("Could not parse article content");
    }

    if (result.error) {
      throw new Error(result.error);
    }

    articleData = result;
    titleInput.value = result.title || "Untitled";
    previewEl.innerHTML = result.content || "<p>No content found</p>";
    showState("content");

  } catch (err) {
    showError(err.message || "Failed to parse article");
  }
}

// This function runs in the page context (MAIN world)
function parseWithReadability() {
  try {
    // Clone the document to avoid modifying the original
    const documentClone = document.cloneNode(true);

    // Check if Readability is available
    if (typeof Readability === "undefined") {
      return { error: "Readability library failed to load", usedReadability: false };
    }

    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (!article) {
      return { error: "Readability could not parse this page", usedReadability: true };
    }

    // Hybrid recovery: restore headers and images that Readability may have stripped
    const enhancedContent = recoverMissingElements(document, article.content);

    return {
      title: article.title,
      content: enhancedContent,
      textContent: article.textContent,
      length: article.length,
      usedReadability: true
    };
  } catch (err) {
    return { error: err.message, usedReadability: "error" };
  }

  // Recover headers and images that Readability stripped (nested function)
  function recoverMissingElements(originalDoc, readabilityHtml) {
    const parser = new DOMParser();
    const readabilityDoc = parser.parseFromString(readabilityHtml, "text/html");
    const readabilityBody = readabilityDoc.body;
    const readabilityText = readabilityBody.textContent || "";

    // === FIND ARTICLE CONTAINER ===
    // Look for the main article area to limit our search scope
    const articleSelectors = [
      '[data-testid="twitterArticleReadView"]', // Twitter articles
      'article',
      '[role="article"]',
      '.post-content',
      '.article-content',
      '.entry-content',
      'main'
    ];
    let articleContainer = null;
    for (const sel of articleSelectors) {
      articleContainer = originalDoc.querySelector(sel);
      if (articleContainer) break;
    }
    if (!articleContainer) articleContainer = originalDoc.body;

    // === RECOVER HEADERS ===
    const originalHeaders = articleContainer.querySelectorAll("h1, h2, h3, h4");
    const headersToInject = [];

    originalHeaders.forEach(header => {
      const headerText = header.textContent.trim();

      if (headerText.length < 3) return;
      if (readabilityText.includes(headerText)) return;

      // Get text that follows this header in document order
      // Use TreeWalker starting from header, skip to next text nodes
      let followingText = "";
      const walker = document.createTreeWalker(
        articleContainer,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      // Position walker at header
      let foundHeader = false;
      let node;
      while (node = walker.nextNode()) {
        if (!foundHeader) {
          // Check if this text node is inside or after our header
          if (header.contains(node)) {
            foundHeader = true;
          }
          continue;
        }
        // We're past the header, collect text
        const text = node.textContent.trim();
        if (text.length > 20) {
          followingText = text;
          break;
        }
      }

      if (followingText.length > 20) {
        headersToInject.push({
          tag: header.tagName.toLowerCase(),
          text: headerText,
          followingText: followingText.slice(0, 150)
        });
      }
    });

    // === RECOVER IMAGES ===
    const existingImgSrcs = new Set();
    readabilityBody.querySelectorAll("img").forEach(img => {
      if (img.src) existingImgSrcs.add(img.src);
    });

    const imagesToInject = [];

    // Only look for images within article container
    articleContainer.querySelectorAll("img").forEach(img => {
      const src = img.src || "";
      if (!src || src.startsWith("data:") || existingImgSrcs.has(src)) return;

      // Filter out small images (avatars, icons)
      const rect = img.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) return;

      // Filter out images that don't look like content images
      if (src.includes("profile") || src.includes("avatar") || src.includes("emoji")) return;

      imagesToInject.push({ src, alt: img.alt || "" });
    });

    // Check background images in article container
    articleContainer.querySelectorAll("[style*='background-image']").forEach(el => {
      const style = el.getAttribute("style") || "";
      const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
      if (match && match[1]) {
        const src = match[1];
        if (src.startsWith("data:") || existingImgSrcs.has(src)) return;
        if (src.includes("profile") || src.includes("avatar") || src.includes("emoji")) return;

        // Check element size
        const rect = el.getBoundingClientRect();
        if (rect.width >= 100 && rect.height >= 100) {
          imagesToInject.push({ src, alt: "" });
        }
      }
    });

    // === RECOVER LINK TEXT ===
    // Readability sometimes strips text inside links
    const originalLinks = articleContainer.querySelectorAll("a[href]");
    const readabilityFullText = readabilityBody.textContent;

    originalLinks.forEach(link => {
      const linkText = link.textContent.trim();

      if (linkText.length < 2) return;
      if (readabilityFullText.includes(linkText)) return;
      if (link.closest("h1, h2, h3, h4")) return;

      // Use TreeWalker to find text after this link in document order
      // Skip text nodes that are inside other links
      const docWalker = document.createTreeWalker(articleContainer, NodeFilter.SHOW_TEXT, null, false);
      let foundLink = false;
      let followingText = "";
      let docNode;

      while (docNode = docWalker.nextNode()) {
        if (!foundLink) {
          if (link.contains(docNode)) {
            foundLink = true;
          }
          continue;
        }
        // Past the link - get following text, but skip if inside another link
        if (docNode.parentElement.closest("a")) {
          continue; // Skip text inside links
        }
        const text = docNode.textContent.trim();
        if (text.length > 3) {
          followingText = text;
          break;
        }
      }

      if (followingText.length < 3) return;

      // Find this following text in Readability output and insert link text before it
      const searchText = followingText.slice(0, 30);
      const walker = document.createTreeWalker(readabilityBody, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        const nodeText = node.textContent;
        if (nodeText.includes(searchText.slice(0, 15))) {
          // Insert the link text before this match
          const index = nodeText.indexOf(searchText.slice(0, 15));
          const before = nodeText.slice(0, index).trimEnd();
          const after = nodeText.slice(index).trimStart();

          node.textContent = before + (before.length > 0 ? " " : "") + linkText + " " + after;
          break;
        }
      }
    });

    // === INJECT INTO OUTPUT ===
    if (headersToInject.length === 0 && imagesToInject.length === 0) {
      return readabilityHtml;
    }

    // Find leaf paragraphs that directly contain substantial text
    const allParagraphs = readabilityBody.querySelectorAll("p, div");
    const paragraphs = Array.from(allParagraphs).filter(el => {
      const hasBlockChildren = el.querySelector("p, div");
      return el.textContent.trim().length > 30 && !hasBlockChildren;
    });

    headersToInject.forEach(header => {
      const searchText = header.followingText.slice(0, 80);

      for (const para of paragraphs) {
        const paraText = para.textContent.trim();

        // Check if paragraph starts with our search text
        if (paraText.startsWith(searchText.slice(0, 30)) ||
            paraText.slice(0, 50).includes(searchText.slice(0, 25))) {
          const headerEl = readabilityDoc.createElement(header.tag);
          headerEl.textContent = header.text;
          para.parentNode.insertBefore(headerEl, para);
          break;
        }
      }
    });

    // Inject first article image at top (just one main image)
    if (imagesToInject.length > 0) {
      const imgEl = readabilityDoc.createElement("img");
      imgEl.src = imagesToInject[0].src;
      imgEl.alt = imagesToInject[0].alt;
      imgEl.style.maxWidth = "100%";
      imgEl.style.height = "auto";
      imgEl.style.display = "block";
      imgEl.style.margin = "0 0 1em 0";

      if (readabilityBody.firstChild) {
        readabilityBody.insertBefore(imgEl, readabilityBody.firstChild);
      } else {
        readabilityBody.appendChild(imgEl);
      }
    }

    return readabilityBody.innerHTML;
  }
}

async function beamToKindle() {
  if (!articleData) {
    showError("No article data available");
    return;
  }

  beamBtn.disabled = true;
  beamBtn.textContent = "Sending...";
  beamBtn.classList.add("sending");

  const payload = {
    title: titleInput.value || "Untitled",
    content: articleData.content,
    url: currentUrl
  };

  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, payload);

    if (response && response.success) {
      showState("success");
    } else {
      const errorMsg = response?.error || "Unknown error occurred";
      showError(errorMsg);
    }
  } catch (err) {
    let errorMsg = err.message || "Failed to send to Kindle";

    // Provide more helpful error messages
    if (errorMsg.includes("not found") || errorMsg.includes("Specified native messaging host not found")) {
      errorMsg = "Native host not installed. Run install.sh first.";
    } else if (errorMsg.includes("disconnected")) {
      errorMsg = "Native host crashed. Check the Python script for errors.";
    }

    showError(errorMsg);
  } finally {
    beamBtn.disabled = false;
    beamBtn.textContent = "Beam to Kindle";
    beamBtn.classList.remove("sending");
  }
}

// Event listeners
beamBtn.addEventListener("click", beamToKindle);

retryBtn.addEventListener("click", () => {
  parseArticle();
});

backLink.addEventListener("click", (e) => {
  e.preventDefault();
  window.close();
});

// Initialize
parseArticle();
