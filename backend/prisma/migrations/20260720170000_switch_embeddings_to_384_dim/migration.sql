-- Switch embedding columns from vector(1536) (OpenAI dimension) to vector(384)
-- to match the locally-run Xenova/all-MiniLM-L6-v2 embedding model (no API key required).
ALTER TABLE "CandidateProfile" ALTER COLUMN "resumeEmbedding" TYPE vector(384);
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "embedding" TYPE vector(384);
ALTER TABLE "Job" ALTER COLUMN "embedding" TYPE vector(384);
