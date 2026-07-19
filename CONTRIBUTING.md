# Contributing to BallOut Pro

First off, thanks for taking the time to contribute! 🏏

## How Can I Contribute?

### 🐛 Reporting Bugs

- Use the [GitHub Issues](https://github.com/abhigyan6/Balloutpro-/issues) page
- Include steps to reproduce, expected vs actual behavior, and screenshots if applicable
- Include your browser and OS version

### 💡 Suggesting Features

- Open an issue with the `enhancement` label
- Describe the feature, its use case, and why it would be valuable

### 🔧 Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code, ensure it passes `npm run lint`
3. Make sure your code builds with `npm run build`
4. Write a clear PR description explaining **what** and **why**

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/Balloutpro-.git
cd Balloutpro-
npm install
cp .env.example .env
npm run dev
```

## Code Style

- TypeScript strict mode
- Functional React components with hooks
- Tailwind CSS for styling (no inline styles)
- Meaningful variable and function names

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `style:` — formatting, no code change
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or updating tests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
