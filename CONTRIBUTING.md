# Contributing to DadaBot

Thank you for contributing to DadaBot! 🎉

## 🎯 Ways to Contribute

- **Code**: Core packages, web app, mobile, CLI
- **Documentation**: README, guides, API docs
- **Testing**: Unit tests, E2E tests, manual testing
- **Bug Reports**: Issues with reproduction steps
- **Feature Requests**: Ideas for new capabilities
- **Translations**: i18n (see `web-app/src/i18n.ts`)

## 🚀 Quick Start for Contributors

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_FORK/dadabot.git
cd dadabot

# 2. Install dependencies
cd web-app && npm install

# 3. Run tests (must pass)
./test-all.sh

# 4. Start dev server
npm run dev
# → http://localhost:5173
```

## 📋 Development Workflow

### 1. Create Feature Branch
```bash
git checkout -b feat/your-feature-name
```

### 2. Make Changes
- Follow existing code style
- Add tests for new functionality
- Update documentation if needed

### 3. Run Quality Checks
```bash
# All tests (67/67 must pass)
./test-all.sh

# TypeScript typecheck
cd web-app && npx tsc --noEmit

# Lint
npx eslint . --ext .ts,.tsx
```

### 4. Commit & Push
```bash
git add .
git commit -m "feat: add amazing feature"
git push origin your-branch
```

### 5. Open Pull Request
- Link related issues
- Describe changes clearly
- Include screenshots for UI changes

## 🧪 Testing Standards

| Test Type | Command | Coverage Target |
|-----------|---------|-----------------|
| Unit | `./test-all.sh` | 100% (67/67) |
| BATS | `bats test/install.bats` | Installer paths |
| Pester | `Invoke-Pester test/Install.Tests.ps1` | Windows installer |
| Visual Regression | `npm run test:visual` | Landing sequence |

## 📝 Code Style

- **TypeScript**: Strict mode, no `any`, explicit types
- **React**: Functional components, hooks, TypeScript
- **Imports**: Use `@/` alias, relative paths for cross-package
- **Naming**: PascalCase components, camelCase functions/variables
- **Comments**: JSDoc for public APIs, inline for complex logic

## 🏗 Architecture Guidelines

### Adding New Packages
1. Create in `web-app/packages/your-package/`
2. Follow existing structure:
   ```
   your-package/
   ├── package.json
   ├── tsconfig.json
   ├── src/
   │   ├── index.ts          # Barrel export
   │   ├── core.ts           # Main logic
   │   └── types.ts          # Shared types
   ├── test/
   │   └── your-package.test.ts
   └── README.md
   ```
2. Add to `web-app/vite.config.ts` aliases
3. Add tests following existing patterns

### Adding New Web Pages
1. Create component in `src/components/YourPage/`
2. Add route in `src/App.tsx`
3. Add navigation in `src/components/NavBar.tsx`
4. Add tests in `__tests__/`

### Modifying Core Packages
- **busabase-adapter**: Human approval workflow, policies, Inbox
- **affine-adapter**: BlockSuite integration, Y.js sync, BlockCanvas
- **proposal-bridge**: 5-stage pipeline, executors, synopsis

## 🐛 Bug Reports

Use the bug report template:
```markdown
## Bug Description
Clear description of the issue.

## Reproduction Steps
1. Step 1
2. Step 2
3. Step 3

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens.

## Environment
- OS: macOS/Windows/Linux
- Node: version
- Browser: Chrome/Firefox/Safari
- DadaBot: version

## Logs/Screenshots
Attach relevant logs or screenshots.
```

## ✨ Feature Requests

Use the feature request template:
```markdown
## Feature Description
Clear description of the proposed feature.

## Use Case
Why is this needed? Who benefits?

## Proposed Solution
How should it work?

## Alternatives Considered
Other approaches you've considered.

## Additional Context
Any other relevant information.
```

## 🌐 Internationalization

- All user-facing strings in `web-app/src/i18n.ts`
- Add new keys following existing pattern
- Test with `npm run dev` and language switcher

## 📦 Release Process

Maintainers only:
1. `./scripts/release-checklist.sh`
2. Tag release: `git tag vX.Y.Z && git push origin vX.Y.Z`
3. Verify GitHub Actions release pipeline
4. Publish GitHub Release
5. Auto-submitted package manager PRs
6. Verify all install methods

## 📞 Getting Help

- **Discord**: [DadaBot Community](https://discord.gg/dadabot)
- **GitHub Discussions**: For questions and ideas
- **Email**: smartartificialmind@gmail.com

## 🙏 Recognition

Contributors are recognized in:
- `CONTRIBUTORS.md`
- Release notes
- GitHub contributors graph

Thank you for making DadaBot better! 🙏