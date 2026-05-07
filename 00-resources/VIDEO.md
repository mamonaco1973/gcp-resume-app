#GCP #VertexAI #GenerativeAI #Serverless #CloudFunctions #Terraform #Python #Firebase

*Build an AI Resume Scorer on GCP (Vertex AI + Cloud Functions + Pub/Sub)*

Score any resume against a job posting using a fully serverless, event-driven pipeline on Google Cloud Platform — provisioned with Terraform and deployed with a single script. Users sign in with Identity Platform (Firebase Auth), upload a resume, paste a job URL or description, and a Pub/Sub-driven worker invokes Vertex AI Gemini to extract job metadata and return a 0–100 compatibility score with a written Strengths and Weaknesses analysis.

In this project we build an asynchronous AI scoring pipeline from scratch — the API returns immediately with a submitted status, Pub/Sub decouples the slow Gemini inference call from the API response, and a worker Cloud Function handles URL fetching, HTML parsing, and two sequential Gemini calls. The whole thing runs without a single VM.

WHAT YOU'LL LEARN
• Invoking Vertex AI Gemini from Cloud Functions 2nd Gen for multi-step AI pipelines
• Using Pub/Sub + Eventarc to decouple slow Gemini inference from a synchronous API response
• Fetching and parsing job posting HTML with BeautifulSoup before sending to Gemini
• Implementing Firebase email/password sign-in in-page (no redirect) with GCP Identity Platform
• Validating Firebase JWTs in Cloud API Gateway via OpenAPI 2.0 securityDefinitions
• Two-collection Firestore design with per-user doc ID prefix for data isolation
• Storing and retrieving user content (resumes, analyses, notes) from private GCS paths
• Parameterizing a Vertex AI model via gemini-config.sh for easy model swapping

INFRASTRUCTURE DEPLOYED
• Identity Platform (email/password sign-in) with browser-scoped API key (identitytoolkit.googleapis.com)
• Cloud API Gateway with Swagger 2.0 spec (Firebase JWT securityDefinitions, x-google-issuer)
• API Cloud Function (2nd Gen, Python 3.11, HTTP trigger): routes /resumes and /jobs endpoint families
• Worker Cloud Function (2nd Gen, Python 3.11, Eventarc/Pub/Sub trigger): Gemini scoring pipeline
• Pub/Sub topic (job-requests) + Eventarc trigger connecting topic to worker CF2
• Firestore database (Native mode) with two collections: resume_app_resumes, resume_app_jobs
• GCS media bucket (private, SSE) + GCS frontend bucket (public SPA hosting)
• Service accounts with least-privilege access to Firestore, GCS, Pub/Sub, Vertex AI, and Cloud Run

GitHub
https://github.com/mamonaco1973/gcp-resume-app

README
https://github.com/mamonaco1973/gcp-resume-app/blob/main/README.md

TIMESTAMPS
00:00 Introduction
00:21 Architecture
00:59 Build the Code
01:16 Build Results
01:52 Demo
