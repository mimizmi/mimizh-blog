
OOP最大的优点是万物皆对象，使得高级语言能以更适合人思考的方式进行编写，最大的缺点却也是对象体系，使得大型系统编写中的复杂度急剧上升，难以控制，况且在机器日渐发展、编程语言和技巧臻化的过程中，逐渐达到瓶颈。于是开始有人思考，也许我们应该考虑更贴合机器的编程方式，以最大贴合机器的发展，利用机器的优势。这就是DOP(data-oriented programming)

多重继承、复杂的对象层次结构，高度绑定的行为和数据，全都是OOP便于理解所带来的繁琐代价。

### 分离 `code` 和 `data`

> PRINCIPLE #2 Represent data entities with generic data structures.

为了构建DOP，首先要解决的是分离`code`和`data`，`code`即为`stateless function`模块，`data`作为`code`的参数

从这里开始，`data`不再与所谓“类型”的状态强绑定，实现`data`的表示方法可以有很多，我觉得最直观的是JSON，在各种语言中，使用哈希表或者是字典实现，因此也天然几乎0成本支持序列化。在使用上，由于没有了“类型”的概念，最重要的是`data`的内容本身，很有意思的是，使用起来非常像数据库，包括但不限于条件筛选，链式查询等等。或许换一种理解，面向对象本身最大的问题，在于割裂了数据在多个维度间传递的本能，因此面向数据的核心很简单，只是为了还原数据这种天然的传递本能，而其余都是为了达到这点做的手段。

### 处理 mutation

> PRINCIPLE #3 Data is immutable

#### calculation phase
我们讲在DOP的系统中，code通常是**stateless**的，然而数据的变更在系统中总是不可避免的，系统状态也总是有被修改的时候，我们只能尽可能的使得系统运作中大部分的时候是状态无关的，对于触及系统状态修改的这部分，至关重要。

函数直接原地修改数据的值被称为`mutable function`, 而如果根据原数据，返回全新修改后的数据，称为**immutable**。为了使得操作修改这一步的函数保持**stateless**以提高系统效率，我们期望数据修改是**immutable**的。

为了支持data immutable，首先考虑到的是每次数据修改使用深拷贝，返回全新的数据，但是这样做的弊端显而易见。考虑到使用`stateless function`进行并行处理数据后，总归还是要有一个**commit**的阶段，以作为系统一致性的保证，在普遍的系统中，最常见的是版本控制，幸好成熟的版本控制工具`git`在这方面有很深的研究和实践，我们在这里同样参考这种形式，作增量拷贝，共享相同重用的部分。同时这种形式恰好可以避免数据完整的深拷贝。

实现这样的数据结构并不是一个简单的工程，下面是几个主流语言的实现作为参考学习，这种管理方式同样是解决多线程并发问题的关键，值得一提的是Rust语言无论是从编程哲学还是设计理念，都有很好的遵循这点，因此Rust直到今天，算是世界上最安全，也非常高效的语言：
[C#](https://learn.microsoft.com/en-us/archive/msdn-magazine/2017/march/net-framework-immutable-collections)、[Python](https://github.com/tobgu/pyrsistent)、[JavaScript](https://immutable-js.com/)

#### commit phase

这个阶段要对系统的状态进行维护和更新，既是一个极其重要的行为，同时也是一个极其危险的行为，稍不注意，整个系统就会造成不可预期的错误。思来想去，在一个全局的单例中进行这部分操作是不可避免的，也是最好的。

进而我们可以在这个系统单例中将数据状态验证与`stateless`的数据修改行为解耦。


### mutation的并发问题
![454](assets/Complexity%20of%20object-oriented%20programming/file-20261013112350466.png)

#### reconciliation algorithm

When previous differs from current, it means that concurrent mutations have run. In order to determine whether there is a conflict, we calculate two diffs: the diff between previous and current and the diff between previous and next. If the intersection between the two diffs is empty, it means there is no conflict. We can safely patch the changes between previous to next into current.


### Unit Tests

DOP系统中的单元测试简直简单到不可思议，由于系统的面向数据的，我们只需按需构造输入数据与目标数据，通过函数后验证即可。

### Scalability

至此尽管DOP拥有很多优点，但就实际开发场景来说，至少以下几点问题存在
* 数据不再具有类型属性，因此在多人合作开发下，数据的具体结构可能是封闭隐式未知的
* 尽管使用了commit策略来减少并发对系统造成危害，但整体上来说系统仍然是线程不安全的，而且单例作为系统状态的控制中枢，随着规模进一步扩大，会成为系统的性能瓶颈
* immutable data在数据规模增大的情况下仍然可能成为性能瓶颈
* 

#### Data Validation

> PRINCIPLE #4 Separate data schema from data representation.

DOP中的验证其实很类似于OOP中的类型定义，区别在于是处在系统多维度的边界进行验证，也就是跨维度的验证预定义，我们称之为数据的schema，比如JSON，Protobuf，甚至可以类比当作网络中数据传递的协议，正如我说过的，计算机领域的概念和应用总是相通的。

#### Advanced Concurrency Control


简单来说，我们使用atomic(CAS)操作，而不是使用锁，atomic的实现基于CPU所提供的CAS(Compare And Swap)能力。
##### CAS
>若目标值的状态与上一次比较存在差异，表明此时其他的线程中存在并发，且其中一个线程已经对该值进行了修改，对当前线程而言将更新状态并重试比较，直到发现目标值的状态没有被其他线程修改才执行具体修改操作。

由于每次并发竞争中一定有一个获胜者成功修改值，因此atomic在理论上不存在“死锁”

下面是几种主流语言的实现参考：
* [C#](http://mng.bz/6Zzp)
* [Java](http://mng.bz/mx0W)
* [Ruby](http://mng.bz/5KG8)













