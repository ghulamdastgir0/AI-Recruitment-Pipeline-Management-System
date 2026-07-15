-- DropForeignKey
ALTER TABLE "AIGeneratedQuestion" DROP CONSTRAINT "AIGeneratedQuestion_interviewId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_candidateProfileId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_jobId_fkey";

-- DropForeignKey
ALTER TABLE "CandidateProfile" DROP CONSTRAINT "CandidateProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "CandidateSkill" DROP CONSTRAINT "CandidateSkill_candidateProfileId_fkey";

-- DropForeignKey
ALTER TABLE "CandidateSkill" DROP CONSTRAINT "CandidateSkill_skillId_fkey";

-- DropForeignKey
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "InterviewFeedback" DROP CONSTRAINT "InterviewFeedback_interviewId_fkey";

-- DropForeignKey
ALTER TABLE "JobInterviewer" DROP CONSTRAINT "JobInterviewer_jobId_fkey";

-- DropForeignKey
ALTER TABLE "JobSkill" DROP CONSTRAINT "JobSkill_jobId_fkey";

-- DropForeignKey
ALTER TABLE "JobSkill" DROP CONSTRAINT "JobSkill_skillId_fkey";

-- AlterTable
ALTER TABLE "AIGeneratedQuestion" ADD COLUMN     "answerText" TEXT,
ADD COLUMN     "candidateAudioUrl" TEXT,
ADD COLUMN     "questionAudioUrl" TEXT;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobInterviewer" ADD CONSTRAINT "JobInterviewer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneratedQuestion" ADD CONSTRAINT "AIGeneratedQuestion_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewFeedback" ADD CONSTRAINT "InterviewFeedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
