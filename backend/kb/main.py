from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kb.api.ingest import router as ingest_router


def create_app() -> FastAPI:
    app = FastAPI(title="Knowledge Base API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ingest_router)
    return app


app = create_app()
