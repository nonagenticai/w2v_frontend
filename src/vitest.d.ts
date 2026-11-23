// vitest 5 no longer routes its Assertion type through the global jest.Matchers
// interface, so the jest-style augmentation loaded from app.d.ts stops reaching
// it. The vitest entry of @testing-library/jest-dom augments vitest directly.
import '@testing-library/jest-dom/vitest';
