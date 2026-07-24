-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "applicantEmail" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_applicantEmail_key" ON "Application"("jobId", "applicantEmail");
