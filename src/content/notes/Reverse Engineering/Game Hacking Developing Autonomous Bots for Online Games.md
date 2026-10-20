

小时候玩游戏胡乱捣鼓CE，发现原来游戏不止玩起来有趣，研究游戏背后隐藏的内容同样很有意思。现在正式步入游戏开发领域，才发现不止玩游戏和设计游戏，逆向、反编译同样也是游戏开发者必不可少的能力之一。

我知道在这之前需要打牢很多底层的知识，但毕竟兴趣才是最好的驱动力，这本书从胡乱摸索捣鼓，正式步入系统性地使用工具对游戏进行剖析，并实践制作脚本工具，我认为是一个比较有趣的开篇。

所有教材涉及的素材和源码可见：[GameHackingCode](https://github.com/GameHackingBook/GameHackingCode)
## Tools of the Trade

>each unique kit is built from the same four-piece powerhouse: a memory scanner, an assembler-level debugger, a process monitor, and a hex editor.

### Pointer Scaning
值扫描很简单，加载进程，通过初始扫描，后续认为添加“entropy”扰动内存里数据的值，进行一步一步后续扫描，直到确定终值。

值扫描虽然很简单，但通常只能作为第一步，对于大部分情况并不能直接预期修改这个值而达成目标，尤其是这个对象频繁创建和销毁时，捕获的这个实例对象每次创建的地址是不同的。

为解决此问题比较深入有用的是使用指针扫描。

举书本中例题的例子，假设我们有一个小球和一个终点值。每次小球抵达终点后，会销毁并重新生成小球，为了达成自动通关的效果，我们需要固定小球的位置，每次tick，都将最新的小球指针指向的地址的值改成终点的值。

指针链扫描的关系是对象内部字段的偏移关系

这个概念从代码中能够清晰的理解指针链所表示的关系

```c++
//举个比较明显的链式结构
//首先从编程者的角度考虑，小球存储一定是有个固定指针在地址中是不变的
//例如
LocationPointerSimulator * ballLocation;

//此后创建新小球，将目标对象的地址赋给这个指针，同时释放旧对象，如
auto old = ballLocation
ballLocation = NewLocationPointer(new Location());
delete old;

```

LocationPointerSimulator类的内部布局可能非常复杂，这里为了演示设计了如下的内部字段，通过增加占位符和链式结构体丰富这个类的“槽位”概念：
```c++
class LocationPointerSimulator{
private:
	struct LocationPointerSimulator3
	{
		char placeholders[32];
		Location* location;
	};

	struct LocationPointerSimulator2
	{
		char placeholders[64];
		LocationPointerSimulator3* step;
	};

	char placeholders[128];
	LocationPointerSimulator2* step;
}
```

很显然ballLocation指针一经分配不会频繁销毁，但是指针所指向的具体对象每次分配由分配器重新决定。换句话说，有了LocationPointerSimulator类的内部布局的关系，也就是这个类“槽位”在地址中的关系，我们就可以由基址一路寻找到真正存储小球坐标类的指针`ballLocation -> step(2) -> step(3) -> location`，在内存中，这个类中槽位的偏移是固定的。

最后由指针`location`，找到小球值的最新分配的地址，并进行值改写，即完成目标。

注意这里有两处指针的跳转关系，可以看到delete old是把整个LocationPointerSimulator的实例对象释放了，由指针`ballLocation`仍可以先找到最新分配的LocationPointerSimulator的实例对象的地址，接着根据对象的槽位进行跳转找到存储Location实例地址的指针`location`，接着由这个指针跳转到最终目标实例的地址。

> 忽然发现做完一次指针扫描分析，所谓指针和实例地址的概念就豁然开朗了。

