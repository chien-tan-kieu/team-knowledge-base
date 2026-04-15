import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

// In Tailwind v4, design tokens are configured via CSS @theme in globals.css.
// This file is kept for JS-based plugins and future extensions.
export default {
  plugins: [typography()],
} satisfies Config
