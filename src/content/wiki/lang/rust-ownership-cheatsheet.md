---
title: Rust 所有权速查
date: "2025-11"
description: 所有权、借用、生命周期的核心规则汇总
---

## 三条基本规则

- 每个值有且只有一个所有者
- 所有者离开作用域时值被释放
- 值在任意时刻只能有一个可变引用，或任意多个不可变引用，二者不能共存

## Move vs Copy

实现了 Copy trait 的类型赋值时自动复制；其他类型默认移动（Move）语义。

## 常见模式

```rust
// 借用而非转移所有权
fn process(data: &Vec<i32>) { /* ... */ }

// 需要修改时使用可变引用
fn update(data: &mut Vec<i32>) { /* ... */ }

// Clone 显式复制
let v2 = v1.clone();
```
