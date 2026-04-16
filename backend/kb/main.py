from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kb.api.ingest import router as ingest_router
from kb.api.wiki import router as wiki_router
from kb.api.chat import router as chat_router
from kb.api.lint import router as lint_router


def create_app() -> FastAPI:
    app = FastAPI(title="Knowledge Base API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(chat_router)
    app.include_router(lint_router)
    return app


app = create_app()
