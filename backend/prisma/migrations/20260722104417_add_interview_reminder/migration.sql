-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'INTERVIEW_REMINDER';

-- AlterTable
ALTER TABLE "AIInterviewSession" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);
