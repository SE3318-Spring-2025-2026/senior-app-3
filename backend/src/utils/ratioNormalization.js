/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ISSUE #236 UTILITY: ratioNormalization.js
 * Ratio calculation, normalization, and precision handling for Process 7.4
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * Provides utilities for computing contribution ratios with support for multiple
 * strategies (fixed, weighted, normalized) and precision policies.
 *
 * DFD Flows Referenced:
 * - f7_p73_p74: Issue #235 (completed story points) → Process 7.4 (ratio calc)
 * - f7_p74_p75: Process 7.4 (ratios) → Process 7.5 (persistence)
 * - f7_p74_p80_external: Process 7.4 → External handoff (grading)
 *
 * Key Design Decisions:
 * 1. RATIO STRATEGIES:
 *    - 'fixed': ratio = completed / target (simple denominator)
 *    - 'weighted': ratio = completed / groupTotal (normalized to group size)
 *    - 'normalized': all ratios sum to ~1.0 (group-wide constraint)
 *
 * 2. PRECISION POLICY:
 *    - Store as IEEE 754 float (DB-native)
 *    - Round on output to 4 decimal places
 *    - Prevent Infinity and NaN (safe guards)
 *
 * 3. EDGE CASE HANDLING:
 *    - Zero target: Return null (signal missing config, caller decides fallback)
 *    - Zero group total: Return null (signal invalid state)
 *    - Negative values: Clamp to [0, 1]
 *    - Ratios > 1: Allow (student can exceed target)
 */

/**
 * ISSUE #236: Normalize a single ratio based on strategy
 *
 * @param {number} completed - Story points completed by student (from Issue #235)
 * @param {number} target - Target story points (from D8 configuration)
 * @param {number} groupTotal - Sum of all completed story points in group
 * @param {string} strategy - 'fixed' | 'weighted' | 'normalized'
 *
 * @returns {number|null}
 *   - Returns number in [0, Infinity) if calculable
 *   - Returns null if invalid input (e.g., target <= 0)
 *   - Caller should treat null as "missing configuration"
 *
 * @throws {Error} If invalid strategy provided
 *
 * Design Note: This function is PURE (no side effects).
 * Same inputs always produce same output (deterministic for idempotency).
 */
function normalizeRatio(completed, target, groupTotal, strategy = 'fixed') {
  // ISSUE #236 SAFETY GUARD #1: Validate inputs
  // Why: Prevent NaN, Infinity, or silent failures
  // What: Check for null, undefined, non-numeric
  if (typeof completed !== 'number' || typeof target !== 'number' || typeof groupTotal !== 'number') {
    console.warn('[ratioNormalization.normalizeRatio] Invalid input types', { completed, target, groupTotal });
    return null;
  }

  // ISSUE #236 SAFETY GUARD #2: Negative values
  // Why: Ratios should be [0, ∞), not negative
  // What: Clamp to 0 if negative (indicates data corruption)
  const normalizedCompleted = Math.max(0, completed);
  const normalizedTarget = Math.max(0, target);
  const normalizedGroupTotal = Math.max(0, groupTotal);

  // ISSUE #236 SAFETY GUARD #3: Zero target handling (Acceptance Criterion #2)
  // Why: Prevent division by zero → NaN
  // What: Return null to signal missing D8 configuration
  // Caller: Will handle fallback (use assigned OR use average)
  if (normalizedTarget <= 0) {
    console.debug('[ratioNormalization.normalizeRatio] Zero target - returning null for fallback');
    return null;  // Signal: configuration missing or invalid
  }

  // ISSUE #236 MAIN CALCULATION: Ratio based on strategy
  let ratio;

  switch (strategy) {
    case 'fixed':
      // STRATEGY: Simple completed/target ratio
      // Use Case: When each student has independent target (e.g., "13 SP per student")
      // Formula: ratio = completed / target
      // Result: Can exceed 1.0 if student overachieves
      ratio = normalizedCompleted / normalizedTarget;
      break;

    case 'weighted':
      // STRATEGY: Weight by group total contribution
      // Use Case: When we want to normalize within group (comparative metric)
      // Formula: ratio = completed / groupTotal (if group total > 0, else fallback to fixed)
      // Result: Each ratio is proportion of group contribution
      // ISSUE #236 SAFETY: If group total is 0, fall back to fixed strategy
      // Why: Can't divide by zero; use target-based ratio instead
      if (normalizedGroupTotal > 0) {
        ratio = normalizedCompleted / normalizedGroupTotal;
      } else {
        // Fallback to fixed if group total unavailable
        console.debug('[ratioNormalization.normalizeRatio] Group total is 0, falling back to fixed strategy');
        ratio = normalizedCompleted / normalizedTarget;
      }
      break;

    case 'normalized':
      // STRATEGY: Ratios must sum to 1.0 across group
      // Use Case: When grading must be zero-sum (fixed total points to distribute)
      // Formula: ratio = completed / target (will be normalized at batch level)
      // Note: This requires batch processing after all students calculated
      ratio = normalizedCompleted / normalizedTarget;
      break;

    default:
      throw new Error(`Invalid ratio strategy: '${strategy}'. Must be 'fixed', 'weighted', or 'normalized'.`);
  }

  // ISSUE #236 SAFETY GUARD #4: Validate result
  // Why: Catch Infinity from edge cases
  // What: Return null if result is not a finite number
  if (!Number.isFinite(ratio)) {
    console.warn('[ratioNormalization.normalizeRatio] Non-finite ratio result', { completed, target, strategy, ratio });
    return null;
  }

  return ratio;
}

/**
 * ISSUE #236: Clamp a ratio value to [0, 1] range
 *
 * @param {number} value - The ratio value to clamp
 * @returns {number} Value clamped to [0, 1]
 *
 * Purpose: Ensure all stored ratios are in valid 0-1 range
 * Note: This is OPTIONAL - some use cases allow >1 (overachievement)
 * Recommendation: Only use if grading system requires [0, 1] constraint
 */
function clampRatio(value) {
  // ISSUE #236: Clamp to [0, 1] range
  // Why: Database schema constraint: min: 0, max: 1
  // What: Use Math.min(Math.max()) for safe bounds checking
  if (!Number.isFinite(value)) {
    return 0;  // Default fallback for invalid values
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * ISSUE #236: Validate that normalized ratios sum to expected value
 *
 * @param {number[]} ratios - Array of ratio values to sum and validate
 * @param {number} expectedSum - Expected sum (typically 1.0)
 * @param {number} tolerance - Floating-point tolerance (default: 0.01)
 *
 * @returns {object}
 *   {
 *     valid: boolean,
 *     actualSum: number,
 *     deviation: number,
 *     message: string
 *   }
 *
 * Purpose: Verify 'normalized' strategy ratios maintain group constraint
 * Note: Floating-point arithmetic has precision limits (~0.01 tolerance OK)
 */
function validateRatioSum(ratios, expectedSum = 1.0, tolerance = 0.01) {
  // ISSUE #236: Calculate actual sum
  // Why: Verify normalized strategy constraint (all ratios sum to ~1.0)
  // What: Sum array, calculate deviation from expected
  if (!Array.isArray(ratios) || ratios.length === 0) {
    return {
      valid: false,
      actualSum: 0,
      deviation: Math.abs(expectedSum),
      message: 'Empty or invalid ratios array'
    };
  }

  // Filter out null/invalid ratios before summing
  const validRatios = ratios.filter(r => typeof r === 'number' && Number.isFinite(r));
  const actualSum = validRatios.reduce((sum, r) => sum + r, 0);
  const deviation = Math.abs(actualSum - expectedSum);

  // ISSUE #236: Check if within tolerance
  // Why: Floating-point math has precision limits
  // Tolerance: 0.01 (1%) is reasonable for most use cases
  const isValid = deviation <= tolerance;

  return {
    valid: isValid,
    actualSum,
    deviation,
    message: isValid
      ? `Sum ${actualSum.toFixed(4)} is within tolerance (${tolerance})`
      : `Sum ${actualSum.toFixed(4)} deviates from expected ${expectedSum} by ${deviation.toFixed(4)} (tolerance: ${tolerance})`
  };
}

/**
 * ISSUE #236: Format ratio for output/display
 *
 * @param {number} value - The ratio value
 * @param {number} decimals - Number of decimal places (default: 4)
 *
 * @returns {number} Rounded to specified decimal places
 *
 * Purpose: Standardize precision in API responses and logging
 * Policy: 4 decimal places provides sufficient precision (0.01%)
 */
function formatRatio(value, decimals = 4) {
  // ISSUE #236 PRECISION POLICY: 4 decimal places
  // Why: Balances precision vs. readability
  // What: Round using 10^decimals technique
  if (!Number.isFinite(value)) {
    return 0;
  }
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * ISSUE #236: Calculate fallback ratio when target is missing
 *
 * @param {number} completed - Student's completed story points
 * @param {number} groupTotal - Sum of all group members' completed points
 * @param {number} groupMemberCount - Number of approved group members
 *
 * @returns {number|null}
 *   - If groupMemberCount > 0: Returns completed / (groupTotal / groupMemberCount)
 *   - Otherwise: Returns null (no valid fallback)
 *
 * Purpose: Graceful handling when D8 targets not configured (Acceptance Criterion #2)
 * Strategy: Use average target (total / members) as fallback denominator
 * Example: Group total 30 SP, 3 members → average 10 SP per member
 *          Student completed 13 SP → ratio = 13 / 10 = 1.3
 */
function calculateFallbackRatio(completed, groupTotal, groupMemberCount) {
  // ISSUE #236: Fallback when D8 targets missing
  // Why: Prevent 422 errors if configuration incomplete
  // What: Use group average as denominator for ratio
  // Design: Only works if group member count > 0
  
  if (groupMemberCount <= 0) {
    return null;  // Cannot calculate fallback
  }

  const averageTarget = groupTotal / groupMemberCount;

  // Use same normalization logic as main function
  return normalizeRatio(completed, averageTarget, groupTotal, 'fixed');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS: Public API for Process 7.4 ratio calculation
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  normalizeRatio,           // Main ratio calculation with strategy support
  clampRatio,               // Constrain to [0, 1] if needed
  validateRatioSum,         // Verify normalized strategy constraint
  formatRatio,              // Round for output
  calculateFallbackRatio,   // Handle missing D8 targets gracefully
};
