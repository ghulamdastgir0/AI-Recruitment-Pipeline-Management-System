-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ViolationType" ADD VALUE 'LOOKING_LEFT';
ALTER TYPE "ViolationType" ADD VALUE 'LOOKING_RIGHT';
ALTER TYPE "ViolationType" ADD VALUE 'LOOKING_DOWN';
ALTER TYPE "ViolationType" ADD VALUE 'LOOKING_UP';
ALTER TYPE "ViolationType" ADD VALUE 'EYES_CLOSED_TOO_LONG';
