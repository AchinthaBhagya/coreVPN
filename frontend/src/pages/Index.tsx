import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart3, Users, Briefcase, DollarSign } from 'lucide-react';

const stats = [
  { title: 'Total Revenue', value: '$0', icon: DollarSign, change: '+0%' },
  { title: 'Active Projects', value: '0', icon: Briefcase, change: '+0%' },
  { title: 'Clients', value: '0', icon: Users, change: '+0%' },
  { title: 'Profit', value: '$0', icon: BarChart3, change: '+0%' },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950/10 to-slate-950 p-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
          3xCode Business Dashboard
        </h1>
        <p className="text-muted-foreground mt-2">Next-Generation Business Operating System</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="border-white/10 bg-black/30 backdrop-blur-md hover:border-blue-500/30 transition-all duration-300">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className="h-4 w-4 text-blue-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.change} from last month</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="border-white/10 bg-black/30 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Welcome to 3xCode Management System</CardTitle>
            <CardDescription>
              A premium, futuristic business operating system for managing your software development business.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This is the foundation of the system. More modules coming soon including CRM, Project Management, 
              Finance, Invoicing, Client Portal, and more.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default Index;
