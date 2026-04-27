---
title: Key Value Server
date: "2026-02-22"
description: k-v server
tags: [distributed-systems, mit, lab]
reading_time: 15 min
---

## Introduction
> Each client interacts with the key/value server using a Clerk, which sends RPCs to the server, Clients can send two different RPCs to the server: `Put(key, value, version)` and `Get(key)`   
> 
> Our goals is to build the server that ensures that each Put operation is executed at-most-once despite network failures and that the operations are [*linearizable*](https://pdos.csail.mit.edu/6.824/papers/linearizability-faq.txt).  
> And implements a client-side locking, which ensures that a sequence of operations issued by a single client is executed atomically and in the correct order, and it isolates these multi-step operations from those of other clients.
## Solution

On the server-side, it's common and easy to use **mutexes** or **channels** to ensure that each individual RPC execution is atomic.  
```go
func (kv *KVServer) Put(args *rpc.PutArgs, reply *rpc.PutReply) {
    kv.mu.Lock() // get the mutex.
    defer kv.mu.Unlock() // make sure mutex will be free
    // Doing Server side executions
}
```

A server-side mutex guarantees that each **individual** Put or Get operation is executed atomically inside the server, but it does not solve any network nondeterminism.

In an unreliable network, RPC requests or replies may be lost, delayed, or duplicated. A client may timeout and retry the same operation.  

If the server cannot detect this, it will execute the same operation twice, violating *at-most-once* semantics and breaking linearizability.  

To prevent duplicate or out-of-date writes, each key in the server maintains a version number.  
```go
if serverVersion == expectedVersion{
    value := newValue
    serverVersion = serverVersion + 1
} else{
    return ErrVersion
}
```
This what we called a **Compare-And-Swap (CAS)** operation:
- compare the expected version 
- swap only if the comparison succeeds

---

Until now, we have achieved our first goal: ensuring that all individual opeartions in the system are atomic and linearizable.  

However, consider the scenario with two clients, c1 and c2, each sending a sequence of operations. For example, both clients may first `Get` a value and then determines what to `Put` based on the result.   

Even though each individual operation is atomic and linearizable, the sequences from c1 and c2 may inerleave in arbitrary ways, potentially producing incorrect or unexpected results.  

One might suggest implementing a server-side lock to strictly control the execution order of each client's requests. While this approach could ensure correctness, it would push responsibilities onto the server far beyond what is necessary.   

In parctice, we want the server to remain as simple and efficient as possible, delegating the management of multi-step atomic sequences to the clients themselves.  

Here is how to use server-side CAS feature to make a client-side lock.

```go
// before sending the actual operations. we need to use Put and Get 
// Acquire and Release the lock. lock state as the key, client id as the value.
func (lk *Lock) Acquire() {
    for {
        value, version, err := lk.ck.Get(lk.key)
        if err == rpc.ErrNoKey || value == "" {
            err = lk.ck.Put(lk.key, lk.id, version)
            if err == rpc.OK {
                return
            } else if err == rpc.ErrMaybe{
                value, version, err = lk.ck.Get(lk.key)
                if err == rpc.ErrNoKey || value == "" {
                    continue
                } else if value == lk.id {
                    return
                }
            } else {
                continue
            }
        }
    }
}

func (lk *Lock) Release() {
    for {
        value, version, err := lk.ck.Get(lk.key)
        if err == rpc.ErrNoKey {
            return
        }
        if value != lk.id {
            return
        }
        err = lk.ck.Put(lk.key, "", version)
        if err == rpc.OK {
            return
        } else if err == rpc.ErrMaybe{
            value, version, err = lk.ck.Get(lk.key)
            if err == rpc.ErrNoKey {
                return
            }
            if value == "" {
                return
            }
            if value != lk.id {
                return
            }
        } else {
            continue
        }
    }
}
```

## Skeleton code

```go
//rpc.go
package rpc
type Err string
const (
    // Err's returned by server and Clerk
    OK         = "OK"
    ErrNoKey   = "ErrNoKey"
    ErrVersion = "ErrVersion"
    // Err returned by Clerk only
    ErrMaybe = "ErrMaybe"
)

type Tversion uint64
type PutArgs struct {
    Key     string
    Value   string
    Version Tversion
}
type PutReply struct {
    Err Err
}
type GetArgs struct {
    Key string
}
type GetReply struct {
    Value   string
    Version Tversion
    Err     Err
}
```

```go
//client.go
package kvsrv
import (
    "6.5840/kvsrv1/rpc"
)
type Clerk struct {
    clnt   *tester.Clnt
    server string
}
func MakeClerk(clnt *tester.Clnt, server string) kvtest.IKVClerk {
    ck := &Clerk{clnt: clnt, server: server}
    return ck
}
func (ck *Clerk) Get(key string) (string, rpc.Tversion, rpc.Err) {
}
func (ck *Clerk) Put(key, value string, version rpc.Tversion) rpc.Err {
}
```

```go
//server.go
package kvsrv

import (
    "sync"
    "6.5840/kvsrv1/rpc"
)
type KVServer struct {
    mu sync.Mutex
    data map[string]KValue
}
type KValue struct {
    Value   string
    Version rpc.Tversion
}
func MakeKVServer() *KVServer {
    kv := &KVServer{}
    kv.data = make(map[string]KValue)
    return kv
}
func (kv *KVServer) Get(args *rpc.GetArgs, reply *rpc.GetReply) {
}
func (kv *KVServer) Put(args *rpc.PutArgs, reply *rpc.PutReply) {
}
```
