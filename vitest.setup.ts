// Registers jest-dom matchers (e.g. toBeInTheDocument) on Vitest's expect and
// augments its types. Imported by every test via vitest.config.ts setupFiles.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
