-- AlterEnum
ALTER TYPE "AppStatus" ADD VALUE 'MANAGER_REVIEW';

-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "candidateEmail" TEXT,
ADD COLUMN     "candidateName" TEXT,
ADD COLUMN     "candidatePhone" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "candidateSummary" TEXT;
