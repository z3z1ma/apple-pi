// Trusted guest prelude: schema compilation is pure Python, so it consumes no host calls or Monty suspensions.
export const PYTHON_SCHEMA_PRELUDE = `import math

def schema(shape):
    def compile(item):
        if isinstance(item, str):
            optional = item.endswith("?")
            primitive = item[:-1] if optional else item
            types = {"str": "string", "string": "string", "int": "integer", "float": "number", "number": "number", "bool": "boolean", "boolean": "boolean"}
            if primitive not in types:
                raise ValueError("Unknown schema type: " + primitive)
            return {"type": types[primitive]}, optional
        if isinstance(item, list):
            if len(item) > 1 and all(isinstance(value, str) for value in item):
                return {"enum": item}, False
            if len(item) != 1:
                raise ValueError("schema arrays must contain one item shape or at least two enum strings")
            child, _ = compile(item[0])
            return {"type": "array", "items": child}, False
        if not isinstance(item, dict):
            raise ValueError("schema shape must be an object")
        keys = list(item.keys())
        if len(keys) == 1 and keys[0] in ("str", "string", "int", "float", "number") and isinstance(item[keys[0]], dict):
            kind = "string" if keys[0] in ("str", "string") else "integer" if keys[0] == "int" else "number"
            fields = item[keys[0]]
            allowed = ("minLength", "maxLength") if kind == "string" else ("minimum", "maximum")
            for key, value in fields.items():
                if key not in allowed or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError("invalid schema constraints")
                if kind == "string" and (not isinstance(value, int) or value < 0):
                    raise ValueError("invalid schema string constraints")
            return {"type": kind, **fields}, False
        if "array" in item and "items" in item and all(key in ("array", "items") for key in keys):
            fields = item["array"]
            children = item["items"]
            if not isinstance(fields, dict) or not isinstance(children, list) or len(children) != 1:
                raise ValueError("invalid schema array constraints")
            for key, value in fields.items():
                if key not in ("minItems", "maxItems") or not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    raise ValueError("invalid schema array constraints")
            child, _ = compile(children[0])
            return {"type": "array", "items": child, **fields}, False
        properties = {}
        required = []
        for raw, child in item.items():
            optional_key = raw.endswith("?")
            name = raw[:-1] if optional_key else raw
            if not name or name in properties:
                raise ValueError("schema property names must be unique and non-empty")
            compiled, optional = compile(child)
            properties[name] = compiled
            if not optional_key and not optional:
                required.append(name)
        return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}, False
    result, _ = compile(shape)
    return result
`;
