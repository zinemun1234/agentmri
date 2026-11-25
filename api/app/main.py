from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .detectors import detect_repeated_tool_loop
from .schemas import CanonicalTrace

app = FastAPI(title='AgentMRI API', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:3000'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/health')
def health():
    return {'ok': True, 'service': 'agentmri-api'}


@app.post('/validate')
def validate_trace(trace: CanonicalTrace):
    return {
        'ok': True,
        'trace_id': trace.trace_id,
        'span_count': len(trace.spans),
        'tool_call_count': sum(1 for span in trace.spans if span.type == 'tool'),
    }


@app.post('/detect/repeated-tool-loop')
def repeated_tool_loop(trace: CanonicalTrace):
    return {'trace_id': trace.trace_id, 'findings': detect_repeated_tool_loop(trace)}
