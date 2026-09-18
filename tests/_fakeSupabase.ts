// Minimal fake of the Supabase query/RPC builder for unit-testing lib wrappers.
// Each terminal `await` (or `.rpc(...)`) invokes `handler` with a description of the call and
// resolves to whatever it returns ({ data } / { error }). Every call is also recorded in `calls`.
//
// Supported chain: from(table).select(...).eq(k,v).in(k,v).limit(n)  and  from(table).insert(payload)
// and rpc(name, args). Enough for dm.ts / search.ts; extend as needed.

export type FakeCall = {
  table: string;
  method: "select" | "insert" | "rpc";
  filters: Record<string, unknown>;
  payload?: unknown;
};
export type FakeResult = { data?: unknown; error?: unknown };

export function fakeSupabase(handler: (call: FakeCall) => FakeResult | void) {
  const calls: FakeCall[] = [];
  function record(call: FakeCall): FakeResult {
    calls.push(call);
    return handler(call) ?? {};
  }
  function builder(table: string, method: FakeCall["method"], payload?: unknown) {
    const filters: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select() {
        return b;
      },
      eq(k: string, v: unknown) {
        filters[`eq:${k}`] = v;
        return b;
      },
      in(k: string, v: unknown) {
        filters[`in:${k}`] = v;
        return b;
      },
      limit() {
        return b;
      },
      insert(p: unknown) {
        return builder(table, "insert", p);
      },
      then(resolve: (r: FakeResult) => unknown) {
        return Promise.resolve(record({ table, method, filters, payload })).then(resolve);
      },
    };
    return b;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    from(table: string) {
      return builder(table, "select");
    },
    rpc(name: string, args: unknown) {
      return {
        then(resolve: (r: FakeResult) => unknown) {
          return Promise.resolve(
            record({ table: `rpc:${name}`, method: "rpc", filters: {}, payload: args })
          ).then(resolve);
        },
      };
    },
  };
  return { supabase, calls };
}
