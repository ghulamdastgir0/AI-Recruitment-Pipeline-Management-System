-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'OFFER_LETTER';

-- AlterEnum
ALTER TYPE "PendingActionStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "AIInterviewSession" ADD COLUMN     "recommendation" TEXT,
ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundJob_status_createdAt_idx" ON "BackgroundJob"("status", "createdAt");
