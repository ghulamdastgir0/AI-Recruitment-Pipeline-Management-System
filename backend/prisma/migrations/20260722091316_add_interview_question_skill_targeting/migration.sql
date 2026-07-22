-- AlterTable
ALTER TABLE "AIInterviewQuestion" ADD COLUMN     "isFollowUp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetSkillId" TEXT;

-- AddForeignKey
ALTER TABLE "AIInterviewQuestion" ADD CONSTRAINT "AIInterviewQuestion_targetSkillId_fkey" FOREIGN KEY ("targetSkillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
