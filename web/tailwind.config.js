module.exports = {
  /* relative: true —— 路径相对本文件（web/），在仓库根目录执行 tailwindcss -c web/tailwind.config.js 也对 */
  content: { relative: true, files: ['./layouts/**/*.html', './content/**/*.md', './static/js/**/*.js', './assets/js/**/*.js'] },
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Inter Fallback', 'ui-sans-serif', 'system-ui', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
      },
      letterSpacing: {
        'heading': '-0.02em',
      },
      colors: {
        m: {
          primary: 'var(--m-primary)',
          'on-primary': 'var(--m-on-primary)',
          'primary-fill': 'var(--m-primary-fill)',
          'on-primary-fill': 'var(--m-on-primary-fill)',
          'primary-container': 'var(--m-primary-container)',
          'on-primary-container': 'var(--m-on-primary-container)',
          secondary: 'var(--m-secondary)',
          'on-secondary': 'var(--m-on-secondary)',
          'secondary-container': 'var(--m-secondary-container)',
          'on-secondary-container': 'var(--m-on-secondary-container)',
          tertiary: 'var(--m-tertiary)',
          'on-tertiary': 'var(--m-on-tertiary)',
          'tertiary-container': 'var(--m-tertiary-container)',
          'on-tertiary-container': 'var(--m-on-tertiary-container)',
          surface: 'var(--m-surface)',
          'on-surface': 'var(--m-on-surface)',
          'on-surface-variant': 'var(--m-on-surface-variant)',
          'container-lowest': 'var(--m-container-lowest)',
          'container-low': 'var(--m-container-low)',
          container: 'var(--m-container)',
          'container-high': 'var(--m-container-high)',
          'container-highest': 'var(--m-container-highest)',
          outline: 'var(--m-outline)',
          error: 'var(--m-error)',
          'on-error': 'var(--m-on-error)',
          'inverse-surface': 'var(--m-inverse-surface)',
          'inverse-on-surface': 'var(--m-inverse-on-surface)',
        },
      },
    },
  },
  plugins: [],
}
