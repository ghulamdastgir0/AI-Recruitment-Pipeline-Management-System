-- CreateEnum
CREATE TYPE "WorkModel" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE');

-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('SELF_APPLIED', 'HR_SOURCED');

-- CreateEnum
CREATE TYPE "CvProcessingStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchRecommendation" AS ENUM ('STRONG_MATCH', 'POTENTIAL_MATCH', 'NEEDS_REVIEW', 'INSUFFICIENT_EVIDENCE');

-- CreateEnum
CREATE TYPE "MatchConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Application" ALTER COLUMN "skillMatchPct" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "cvProcessingError" TEXT,
ADD COLUMN     "cvStatus" "CvProcessingStatus" NOT NULL DEFAULT 'READY',
ADD COLUMN     "resumeContentHash" TEXT,
ADD COLUMN     "resumeFilePath" TEXT,
ADD COLUMN     "resumePagesJson" JSONB,
ADD COLUMN     "source" "CandidateSource" NOT NULL DEFAULT 'SELF_APPLIED',
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "educationJson" DROP NOT NULL,
ALTER COLUMN "experienceYears" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "location" TEXT,
ADD COLUMN     "seniority" TEXT,
ADD COLUMN     "workModel" "WorkModel";

-- AlterTable
ALTER TABLE "JobSkill" ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "overallScore" DECIMAL(5,2) NOT NULL,
    "recommendation" "MatchRecommendation" NOT NULL,
    "confidence" "MatchConfidence" NOT NULL,
    "summary" TEXT NOT NULL,
    "matchedSkillsJson" JSONB NOT NULL,
    "missingRequiredSkillsJson" JSONB NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "breakdownJson" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "detailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAssistantAction" (
    "id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "argsJson" JSONB NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PendingAssistantAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchResult_applicationId_processedAt_idx" ON "MatchResult"("applicationId", "processedAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "PendingAssistantAction_status_expiresAt_idx" ON "PendingAssistantAction"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateProfileId_jobId_key" ON "Application"("candidateProfileId", "jobId");

-- CreateIndex
CREATE INDEX "CandidateProfile_resumeContentHash_idx" ON "CandidateProfile"("resumeContentHash");

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAssistantAction" ADD CONSTRAINT "PendingAssistantAction_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAssistantAction" ADD CONSTRAINT "PendingAssistantAction_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

