-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'APPLICATION_RECEIVED';

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "responsibilities" JSONB;
