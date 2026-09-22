---
title: Iterator Block
description: 迭代器实现原理
tags:
  - CSharp
  - IEnumerator
  - IEnumerable
---
ref: [Iterators, iterator blocks and data pipelines](https://csharpindepth.com/articles/StreamingAndIterators)  [Iterator block implementation details](https://csharpindepth.com/articles/IteratorBlockImplementation)

LINQ是C#非常重大的一个feature，也是一个非常值得深入探讨的主题。然而LINQ并非C#在单个版本中发布的一个单独feature，而是由多个feature组合而成。

迭代器作为C#3.0发布的feature，由此开始窥见LINQ，可以算是LINQ的基石。

迭代器有两个接口，分别是 `IEnumerator` 以及 `IEnumerable`，由于从C#2.0开始进入泛型阶段，因此两个接口各自存在泛型及非泛型定义。

在C# in Depth 4ed原文中，作者是这样阐述这两个接口的关系及区别的：

>An IEnumerable is a sequence that can be iterated over,
whereas an IEnumerator is like a cursor within a sequence. Multiple IEnumerator
instances can probably iterate over the same IEnumerable without changing its state
at all.

> If that didn’t make much sense, you might want to think about an IEnumerable
as a book and an IEnumerator as a bookmark. There can be multiple bookmarks
within a book at any one time. Moving a bookmark to the next page doesn’t change
the book or any of the other bookmarks, but it does change that bookmark’s state: its
position within the book.

我觉得非常形象。





