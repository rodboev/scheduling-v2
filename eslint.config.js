const react = require('eslint-plugin-react')

module.exports = [
  {
    plugins: { react },
    extends: [
      'next/core-web-vitals',
      'eslint:recommended',
      'react/jsx-wrap-multilines',
      'prettier',
    ],
  },
]
