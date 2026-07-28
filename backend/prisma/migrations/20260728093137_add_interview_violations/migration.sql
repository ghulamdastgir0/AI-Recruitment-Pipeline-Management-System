-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('FACE_MISSING', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'MOBILE_DETECTED', 'TAB_SWITCH', 'FULLSCREEN_EXIT', 'WINDOW_BLUR', 'CAMERA_DISABLED', 'MICROPHONE_DISABLED', 'BROWSER_CLOSED', 'SHORTCUT_ATTEMPTED');

-- AlterTable
ALTER TABLE "AIInterviewSession" ADD COLUMN     "terminationReason" TEXT;

-- CreateTable
CREATE TABLE "InterviewViolation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "ViolationType" NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewViolation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewViolation_sessionId_createdAt_idx" ON "InterviewViolation"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "InterviewViolation" ADD CONSTRAINT "InterviewViolation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AIInterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
