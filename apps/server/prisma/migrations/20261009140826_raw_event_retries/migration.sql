-- AlterTable
ALTER TABLE "RawEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retryAt" TIMESTAMP(3);
