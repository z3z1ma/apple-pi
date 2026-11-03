## file

Soul draws stay offline: Wikipedia random-article requests receive numbered fake articles, and every other fetch passes through.
Why: a test that needs a failing draw must stub `fetch` itself; this default must not hide that failure or contact the network.
