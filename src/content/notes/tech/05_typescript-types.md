---
title: TypeScript 高级类型推导实战
description: 条件类型、infer 关键字与递归泛型
tags: [typescript, types, programming]
---

## 条件类型

TypeScript 的条件类型语法类似三元表达式：

```typescript
type IsString<T> = T extends string ? true : false;
```

条件类型配合联合类型时会自动分发，这是很多工具类型的基础。

## Infer 关键字

`infer` 允许我们在条件类型中声明一个待推断的类型变量。最经典的例子是提取函数返回类型：

```typescript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
```

这个模式可以推广到很多场景：提取 Promise 的内部类型、提取数组的元素类型、提取函数参数的类型。

## 递归泛型

TypeScript 支持递归的条件类型，这在处理嵌套数据结构时非常有用。比如深度 Readonly：

```typescript
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object
    ? DeepReadonly<T[K]>
    : T[K];
};
```

但需要注意递归深度限制和循环引用的问题。

## 实际应用

在实际项目中，这些高级类型最常用于构建类型安全的 API 客户端、表单验证库和状态管理。关键原则是让类型系统为你工作，而不是与它对抗。
