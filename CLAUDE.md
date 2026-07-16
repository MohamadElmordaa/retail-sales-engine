# Retail Sales Engine

Retail Sales Engine is a backend service that simulates the transaction processing layer of a multi-store retail point-of-sale (POS) system. The application is responsible for capturing sales transactions from multiple store locations and persisting them into PostgreSQL while maintaining historical accuracy, data integrity, and scalability.

The system supports multiple stores, products, users, currencies, and sales transactions. Each completed sale records a permanent snapshot of the exchange rate used at the time of purchase, ensuring financial data remains historically accurate even if exchange rates change in the future.

## Context Files

Read the following to get the full context of the project.

-@context/project-overview.md
-@context/coding-standards.md
-@context/ai-interaction.md
-@context/current-feature.md


## Commands

```bash
npm run start:dev        # run with hot-reload (watch mode)
npm run start:debug      # run with --debug --watch
npm run build            # nest build → dist/ (wipes dist first)
npm run start:prod       # node dist/main (requires build first)

npm run lint             # eslint --fix over {src,apps,libs,test}
npm run format           # prettier --write

npm test                 # jest unit tests (*.spec.ts, rooted in src/)
npm run test:watch
npm run test:cov         # coverage → coverage/
npm run test:e2e         # jest with test/jest-e2e.json (*.e2e-spec.ts)

# run a single unit test file / test name
npm test -- src/app.controller.spec.ts
npm test -- -t "should return"
```

The server listens on `process.env.PORT ?? 3000`.

