-- Session revocation support: every issued JWT carries the tokenVersion it
-- was minted with; JwtAuthGuard rejects a token whose version no longer
-- matches the row. Bumped on logout and on password change.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
