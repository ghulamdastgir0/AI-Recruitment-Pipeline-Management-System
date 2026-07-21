-- AlterEnum (safe swap: Postgres can't drop/rename enum values in a plain
-- ALTER TYPE ... USING cast when the old value has no same-named counterpart
-- in the new enum. "ADMIN" -> "SUPER_ADMIN" is an explicit data migration,
-- not a rename; the existing seeded admin becomes the first Super Admin.)
CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'HR_ADMIN', 'HIRING_MANAGER');
ALTER TABLE "User" ADD COLUMN "role_new" "Role_new";
UPDATE "User" SET "role_new" = CASE WHEN "role"::text = 'ADMIN' THEN 'SUPER_ADMIN'::"Role_new" END;
ALTER TABLE "User" ALTER COLUMN "role_new" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "role";
ALTER TABLE "User" RENAME COLUMN "role_new" TO "role";
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "JobPostingHiringManager" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "hiringManagerUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPostingHiringManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateComment" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobPostingId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPostingHiringManager_hiringManagerUserId_idx" ON "JobPostingHiringManager"("hiringManagerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "JobPostingHiringManager_jobId_hiringManagerUserId_key" ON "JobPostingHiringManager"("jobId", "hiringManagerUserId");

-- CreateIndex
CREATE INDEX "CandidateComment_candidateId_jobPostingId_idx" ON "CandidateComment"("candidateId", "jobPostingId");

-- CreateIndex
CREATE INDEX "CandidateComment_jobPostingId_idx" ON "CandidateComment"("jobPostingId");

-- AddForeignKey
ALTER TABLE "JobPostingHiringManager" ADD CONSTRAINT "JobPostingHiringManager_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPostingHiringManager" ADD CONSTRAINT "JobPostingHiringManager_hiringManagerUserId_fkey" FOREIGN KEY ("hiringManagerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPostingHiringManager" ADD CONSTRAINT "JobPostingHiringManager_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateComment" ADD CONSTRAINT "CandidateComment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateComment" ADD CONSTRAINT "CandidateComment_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateComment" ADD CONSTRAINT "CandidateComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
