// Vitest setup — registers jest-dom matchers (toBeInTheDocument, etc.).
import '@testing-library/jest-dom/vitest';

/**
 * Polyfill `window.matchMedia` for jsdom — AntD's responsive grid (`<Row>`,
 * `<Col xs={...}>`) and `Grid.useBreakpoint` rely on it. jsdom doesn't ship a
 * real implementation, so without this every render that touches a
 * responsive AntD primitive crashes with "window.matchMedia is not a function".
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined, // legacy
      removeListener: () => undefined, // legacy
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
