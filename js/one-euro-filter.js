// one-euro-filter.js — 1€ Filter for signal smoothing
// Ref: http://cristal.univ-lille.fr/~casiez/1euro/
// Adapts cutoff frequency based on speed: slow movements get more smoothing,
// fast movements get less lag.

class LowPassFilter {
  constructor(alpha = 0.5) {
    this._alpha = alpha;
    this._initialized = false;
    this._prev = 0;
  }

  filter(value, alpha) {
    if (alpha !== undefined) this._alpha = alpha;
    if (!this._initialized) {
      this._initialized = true;
      this._prev = value;
      return value;
    }
    const result = this._alpha * value + (1 - this._alpha) * this._prev;
    this._prev = result;
    return result;
  }

  lastValue() {
    return this._prev;
  }

  reset() {
    this._initialized = false;
    this._prev = 0;
  }
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff - Minimum cutoff frequency (Hz). Lower = smoother when slow. Default 1.0
   * @param {number} beta - Speed coefficient. Higher = less lag when fast. Default 0.007
   * @param {number} dCutoff - Cutoff frequency for derivative filtering. Default 1.0
   */
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this._minCutoff = minCutoff;
    this._beta = beta;
    this._dCutoff = dCutoff;
    this._xFilter = new LowPassFilter();
    this._dxFilter = new LowPassFilter();
    this._lastTime = -1;
    this._frequency = 30; // initial estimate, adapts
  }

  _alpha(cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / this._frequency;
    return 1.0 / (1.0 + tau / te);
  }

  /**
   * Filter a value.
   * @param {number} value - Raw input value
   * @param {number} timestamp - Time in seconds (e.g. performance.now() / 1000)
   * @returns {number} Filtered value
   */
  filter(value, timestamp) {
    if (this._lastTime >= 0) {
      const dt = timestamp - this._lastTime;
      if (dt > 0 && dt < 1) {
        this._frequency = 1.0 / dt;
      }
    }
    this._lastTime = timestamp;

    // Estimate derivative (speed)
    const prevX = this._xFilter.lastValue();
    const dx = this._xFilter._initialized
      ? (value - prevX) * this._frequency
      : 0;

    // Filter the derivative
    const edx = this._dxFilter.filter(dx, this._alpha(this._dCutoff));

    // Adaptive cutoff based on speed
    const cutoff = this._minCutoff + this._beta * Math.abs(edx);

    // Filter the value
    return this._xFilter.filter(value, this._alpha(cutoff));
  }

  reset() {
    this._xFilter.reset();
    this._dxFilter.reset();
    this._lastTime = -1;
    this._frequency = 30;
  }
}

/**
 * Convenience: creates a pair of filters for (x, y) coordinates.
 */
export class OneEuroFilter2D {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this._fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this._fy = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  filter(x, y, timestamp) {
    return {
      x: this._fx.filter(x, timestamp),
      y: this._fy.filter(y, timestamp),
    };
  }

  reset() {
    this._fx.reset();
    this._fy.reset();
  }
}
