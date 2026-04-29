/**
 * Product Card Price Updater
 * Updates product card prices based on fabric size picker selections.
 *
 * Page-context awareness:
 * - Collection/Search pages: Listens for fabricSizeChange events from the size picker.
 *   Prestige products (those with data-price-tiers) update to custom dimension format
 *   e.g. "8' x 5' rug $1,225". Non-Prestige products are never touched.
 * - All other pages: Only runs initial dimension pricing on page load ("From $XXX").
 *   No custom dimension updates since there is no size picker.
 */

// Logging utility with timestamp
const LOG_TAG = "[PricingCalc]";
const log = (message, ...args) => {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
  console.log(`${LOG_TAG} [${timestamp}] ${message}`, ...args);
};

// Store base prices for each product card (to restore when area = 0)
const basePrices = new Map();

// Track last custom sizing area to preserve across morphs
let lastCustomArea = 0;

// Track last custom dimensions for the dimension format (e.g. "8' x 5' rug")
let lastCustomDimensions = null;

// Guard flag: prevents the MutationObserver from re-triggering
// when updateProductPrices() writes to .price elements.
let isUpdatingPrices = false;

/**
 * Detect if we're on a collection/search page by checking for size picker
 * or data-page-context attributes on any product-price element.
 * @returns {boolean}
 */
const isCollectionPage = () => {
  // Primary check: does a size picker exist?
  if (document.querySelector("size-picker-component")) return true;
  // Fallback: check data-page-context on any product-price element
  const firstCard = document.querySelector("[data-page-context]");
  return firstCard?.dataset.pageContext === "collection";
};

// Check if size picker exists before setting up listeners
const checkSizePickerExists = () => {
  const sizePicker = document.querySelector("size-picker-component");
  if (!sizePicker) {
    log("🚫 Size picker component not found, skipping price calculation setup");
    return false;
  }
  log("✅ Size picker component found, setting up price calculation");
  return true;
};

/**
 * Format a number as a dollar amount with comma separators.
 * e.g. 1225 → "$1,225"
 * @param {number} amount
 * @returns {string}
 */
const formatDollar = (amount) => {
  return `$${amount.toLocaleString("en-US")}`;
};

/**
 * Format custom dimension price string.
 * e.g. { widthFeet: 8, widthInches: 0, lengthFeet: 5, lengthInches: 0 } → "8' x 5' rug"
 * @param {object} dimensions - The dimension values from the size picker
 * @returns {string|null} - Formatted dimension string or null if not enough info
 */
const formatDimensionLabel = (dimensions) => {
  if (!dimensions) return null;

  // Extract width and length in feet (converting inches to fractional feet for display)
  const wFeet = parseInt(dimensions["width-feet"]) || 0;
  const wInches = parseInt(dimensions["width-inches"]) || 0;
  const lFeet = parseInt(dimensions["length-feet"]) || 0;
  const lInches = parseInt(dimensions["length-inches"]) || 0;

  // Build display strings
  const widthStr = wInches > 0 ? `${wFeet}'${wInches}"` : `${wFeet}'`;
  const lengthStr = lInches > 0 ? `${lFeet}'${lInches}"` : `${lFeet}'`;

  return `${widthStr} x ${lengthStr} rug`;
};

// Shared function to update all product prices (Prestige products only — those with data-price-tiers)
const updateProductPrices = (area, useInitialDimensions = false) => {
  log(
    "📣 Updating prices for area:",
    area,
    "useInitialDimensions:",
    useInitialDimensions,
  );

  // Set guard flag so the MutationObserver ignores DOM changes we cause
  isUpdatingPrices = true;

  // Find all Prestige product cards (those with price tier data)
  // Non-Prestige products (no data-price-tiers) are never touched by JS.
  const productCards = document.querySelectorAll("[data-price-tiers]");
  log(`📦 Found ${productCards.length} Prestige product cards with price tiers`);

  productCards.forEach((card) => {
    const handle = card.dataset.productHandle;
    const priceTiersJson = card.dataset.priceTiers;
    const initialWidth = parseFloat(card.dataset.initialWidth) || 4;
    const initialLength = parseFloat(card.dataset.initialLength) || 3;

    if (!priceTiersJson) return;

    try {
      const priceTiers = JSON.parse(priceTiersJson);
      const priceElement = card.querySelector(".price");

      if (!priceElement) {
        log(`⚠️ No price element found for ${handle}`);
        return;
      }

      // Store base price HTML on first encounter (preserves span structure)
      if (!basePrices.has(handle)) {
        basePrices.set(handle, priceElement.innerHTML);
        log(`💾 Stored base price for ${handle}: ${priceElement.textContent}`);
      }

      let areaToUse = area;
      let priceFormat = "standard"; // "standard" = $XXX, "from" = From $XXX, "dimension" = 8' x 5' rug $1,225

      // If no custom sizing (area = 0 or < 12), use initial dimensions
      if (area === 0 || area < 12 || useInitialDimensions) {
        areaToUse = initialWidth * initialLength;
        priceFormat = "from";
        log(
          `📐 Using initial dimensions for ${handle}: ${initialWidth} × ${initialLength} = ${areaToUse.toFixed(2)} sq ft`,
        );
      } else if (isCollectionPage() && lastCustomDimensions) {
        // On collection page with custom dimensions selected,
        // use the dimension label format: "8' x 5' rug $1,225"
        priceFormat = "dimension";
      }

      // Find matching price tier
      const tier = priceTiers.find(
        (t) => areaToUse >= t.areaLowerBound && areaToUse < t.areaUpperBound,
      );

      if (tier) {
        const totalPrice = Math.ceil(areaToUse * tier.price);
        let formattedPrice;

        if (priceFormat === "dimension") {
          // Custom dimension format: "<prefix>8' x 5' rug</prefix> <amount>$1,225</amount>"
          const dimensionLabel = formatDimensionLabel(lastCustomDimensions);
          formattedPrice = dimensionLabel
            ? `<span class="price__prefix">${dimensionLabel}</span><span class="price__amount">${formatDollar(totalPrice)}</span>`
            : `<span class="price__prefix">From</span><span class="price__amount">${formatDollar(totalPrice)}</span>`;
        } else if (priceFormat === "from") {
          formattedPrice = `<span class="price__prefix">From</span><span class="price__amount">${formatDollar(totalPrice)}</span>`;
        } else {
          formattedPrice = `<span class="price__amount">${formatDollar(totalPrice)}</span>`;
        }

        log(
          `💰 Setting ${handle} price to "${formattedPrice}" (${areaToUse.toFixed(2)} sq ft × $${tier.price}/sq ft)`,
        );

        priceElement.innerHTML = formattedPrice;

        log(`✅ Price element innerHTML NOW = "${priceElement.innerHTML}"`);

        // Aggressive verification - check multiple times
        [10, 50, 100, 200, 500].forEach((delay) => {
          setTimeout(() => {
            if (priceElement.innerHTML !== formattedPrice) {
              log(
                `🚨 OVERRIDE DETECTED at +${delay}ms for ${handle}! Expected "${formattedPrice}", got "${priceElement.innerHTML}"`,
              );
            } else {
              log(`✓ Price still correct at +${delay}ms for ${handle}`);
            }
          }, delay);
        });
      } else {
        log(
          `⚠️ No price tier found for ${handle} at ${areaToUse.toFixed(2)} sq ft`,
        );
        // Fallback to base price (stored as innerHTML with span structure)
        const basePrice = basePrices.get(handle);
        if (basePrice) {
          priceElement.innerHTML = basePrice;
        }
      }
    } catch (e) {
      log(`❌ Error updating price for ${handle}:`, e);
    }
  });

  // Clear the guard flag after a microtask so the MutationObserver's
  // callback (which fires asynchronously) sees the flag during THIS batch
  // of mutations but not for genuinely new morphs later.
  Promise.resolve().then(() => {
    isUpdatingPrices = false;
  });
};

// Listen for size changes and update prices (only fires on collection page where size picker exists)
document.addEventListener("fabricSizeChange", (event) => {
  // Double-check size picker still exists when event fires
  if (!checkSizePickerExists()) {
    return;
  }

  const area = event.detail?.area || 0;
  const dimensions = event.detail?.dimensions || null;

  // Store the last custom area and dimensions for use after morphs
  lastCustomArea = area;
  lastCustomDimensions = area >= 12 ? dimensions : null;
  log(`💾 Stored lastCustomArea: ${lastCustomArea}, dimensions:`, lastCustomDimensions);

  updateProductPrices(area);
});

// Listen for filter cleared event and revert to initial dimensions
document.addEventListener("fabricSizeFilterCleared", (event) => {
  log("🗑️ Size filter cleared event received", event.detail);

  // Clear the last custom area and dimensions since sizing was cleared
  lastCustomArea = 0;
  lastCustomDimensions = null;
  log(`🗑️ Cleared lastCustomArea and lastCustomDimensions (filter cleared)`);

  // DON'T update prices immediately - a morph is about to happen
  // The MutationObserver will catch it and update after morph completes
  log("⏸️ Skipping immediate price update (morph will trigger recalculation)");

  // Set flag that we're expecting a morph
  expectingMorph = true;
  clearTimeout(morphExpectationTimer);
  morphExpectationTimer = setTimeout(() => {
    expectingMorph = false;
    log("⏱️ Morph expectation window closed");
  }, 1000);

  log("🔔 Morph expectation window opened (1 second)");
});

// Initialize pricing on page load — checks localStorage for active custom sizing first.
// This handles the race condition where the size picker dispatches fabricSizeChange
// (during its connectedCallback) BEFORE this script's event listener is registered,
// since this module loads with fetchpriority="low".
const initializePricing = () => {
  log("🚀 Initializing pricing on page load");
  log(`📍 Page context: ${isCollectionPage() ? "collection/search" : "other"}`);

  if (isCollectionPage()) {
    try {
      const savedState = localStorage.getItem("fabricSizePickerState");
      if (savedState) {
        const state = JSON.parse(savedState);
        if (state.dimensions) {
          let area = 0;
          const dims = state.dimensions;

          if (state.shape === "Rectangular") {
            const w =
              (parseFloat(dims["width-feet"]) || 0) +
              (parseFloat(dims["width-inches"]) || 0) / 12;
            const l =
              (parseFloat(dims["length-feet"]) || 0) +
              (parseFloat(dims["length-inches"]) || 0) / 12;
            area = w * l;
          } else if (state.shape === "Round") {
            const d =
              (parseFloat(dims["diameter-feet"]) || 0) +
              (parseFloat(dims["diameter-inches"]) || 0) / 12;
            area = Math.PI * (d / 2) * (d / 2);
          }

          if (area >= 12) {
            log(
              `📦 Found active custom sizing in localStorage: ${area.toFixed(2)} sq ft`,
            );
            lastCustomArea = area;
            lastCustomDimensions = dims;
            updateProductPrices(area);
            return;
          }
        }
      }
    } catch (e) {
      log("⚠️ Error reading custom sizing from localStorage:", e);
    }
  }

  // No custom sizing found, fall back to initial dimensions
  updateProductPrices(0, true);
};

// Debounce timer for morph recalculation
let morphDebounceTimer = null;

// Track if we're expecting a morph (within 1 second of filter clear)
let expectingMorph = false;
let morphExpectationTimer = null;

// Setup observer to recalculate pricing after DOM morphs (filter changes)
const setupMorphObserver = () => {
  log("👀 Setting up observer for DOM morphs");

  const observer = new MutationObserver((mutations) => {
    log(`👁️ MutationObserver fired with ${mutations.length} mutations`);

    // If WE caused these mutations by writing prices, skip entirely.
    if (isUpdatingPrices) {
      log(`⏭️ Ignoring mutations caused by our own price writes`);
      return;
    }

    // Check if product cards were actually ADDED to the DOM (real morph).
    // IMPORTANT: We only check addedNodes, NOT mutation.target.
    // mutation.target for a text change is the parent element — which could
    // be BODY, and BODY always contains [data-price-tiers] cards, so checking
    // mutation.target would match on EVERY DOM mutation (text, attribute, etc.)
    // and cause an infinite recalculation loop.
    let shouldRecalculate = false;

    for (const mutation of mutations) {
      // Only check genuinely ADDED nodes (section replacements from Horizon morphs)
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          // Skip BODY — it's too broad and matches everything
          if (node.tagName === 'BODY') continue;

          const hasCards = node.matches?.("[data-price-tiers]") ||
                          node.querySelector?.("[data-price-tiers]") ||
                          node.matches?.(".shopify-section") ||
                          node.matches?.(".product-grid-container");

          if (hasCards) {
            log(`🎯 Found product-related morph (addedNode):`, node.tagName, node.id || node.className);
            shouldRecalculate = true;
            break;
          }
        }
      }
      if (shouldRecalculate) break;
    }

    // If we didn't find product cards but we're expecting a morph, recalculate anyway
    if (!shouldRecalculate && expectingMorph) {
      log(`🔔 No product cards detected, but expecting morph - recalculating anyway`);
      shouldRecalculate = true;
    }

    if (!shouldRecalculate) {
      log(`⏭️ No product cards detected in mutations, skipping recalculation`);
    }

    if (shouldRecalculate) {
      // Clear the expectation flag
      expectingMorph = false;
      clearTimeout(morphExpectationTimer);
      log("🔄 Product cards morphed, scheduling recalculation");

      // Debounce to avoid multiple rapid recalculations
      clearTimeout(morphDebounceTimer);
      morphDebounceTimer = setTimeout(() => {
        log("⚡ Executing debounced recalculation after morph");
        // Clear basePrices map since DOM was replaced with fresh elements
        basePrices.clear();
        log("🧹 Cleared basePrices map (fresh DOM from server)");

        // Check if we have active custom sizing
        const hasCustomSizing = lastCustomArea >= 12;
        log(`🔍 Checking custom sizing: lastCustomArea=${lastCustomArea}, hasCustomSizing=${hasCustomSizing}`);

        if (hasCustomSizing) {
          // Preserve custom sizing pricing across morph
          log(`🔒 Preserving custom sizing pricing (${lastCustomArea} sq ft)`);
          updateProductPrices(lastCustomArea, false);
        } else {
          // No custom sizing, use initial dimensions
          log(`📐 Using initial dimensions (no custom sizing active)`);
          updateProductPrices(0, true);
        }
      }, 250); // Increased from 150ms to 250ms to ensure morph completes
    }
  });

  // Observe the entire body since product grid location may vary
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  log("✅ Observer attached to document body");
};

// Run initialization when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initializePricing();
    setupMorphObserver();
  });
} else {
  initializePricing();
  setupMorphObserver();
}

// Log initialization status
if (checkSizePickerExists()) {
  log("🚀 Product card price updater loaded and ready (collection page)");
} else {
  log("🚀 Product card price updater loaded (non-collection page — initial pricing only)");
}
